/**
 * Terminal-independent editor engine state: the prompt draft, one draft per
 * destination, FIFO draft requests, focus hand-off, and height reporting.
 * The textarea engine renders `snapshot()` and feeds content, cursor,
 * submit, and cancel back through this controller.
 */
import { Emitter, EDITOR_REGION, type RegionId } from "./controllers";

export const minHeight = 2;
export const maxHeight = 8;

function sameAssist(
  a: EditorAssist | undefined,
  b: EditorAssist | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  return (
    a !== undefined &&
    b !== undefined &&
    a.cursor === b.cursor &&
    a.items.length === b.items.length &&
    a.items.every((item, index) => item === b.items[index])
  );
}

/** The slice of `RegionController` the editor needs; kept structural on purpose. */
export interface FocusRegions {
  requestFocus(region: RegionId): boolean;
}

export type EditorFocusTarget = "timeline" | "stage";

export interface DraftRequestOptions {
  destination: string;
  label: string;
  requester: RegionId;
  initialText?: string;
  /** Aborting while queued or shown settles the draft as `cancelled`. */
  signal?: AbortSignal;
}

export type DraftResult =
  | { status: "submitted"; text: string }
  | { status: "cancelled" };

/** Transient assist overlay owned by the active editor; not a blocking request. */
export interface EditorAssist {
  items: readonly string[];
  cursor: number;
}

export interface EditorSnapshot {
  text: string;
  cursor: number;
  mode: "prompt" | "draft";
  label?: string;
  destination?: string;
  preferredHeight: number;
  /** Assist to draw on the stage, if any. */
  assist: EditorAssist | undefined;
}

export interface EditorEngine {
  snapshot(): EditorSnapshot;
  subscribe(listener: () => void): () => void;
  openDraft(request: DraftRequestOptions): Promise<DraftResult>;
  requestFocus(target: EditorFocusTarget): void;
}

export interface EditorControllerOptions {
  regions: FocusRegions;
  /** Sends the prompt and resolves whether the session accepted it. */
  sendPrompt?: (text: string) => Promise<boolean>;
  /** Called with the accepted text, after the session accepts the prompt. */
  onPromptAccepted?: (text: string) => void | Promise<void>;
  onAssistChange?: (hasAssist: boolean) => void;
}

interface DraftRequest {
  request: DraftRequestOptions;
  resolve: (result: DraftResult) => void;
  settled: boolean;
  onAbort?: () => void;
}

export class EditorController extends Emitter implements EditorEngine {
  readonly #regions: FocusRegions;
  readonly #sendPrompt: (text: string) => Promise<boolean>;
  readonly #onPromptAccepted: ((text: string) => void | Promise<void>) | undefined;
  readonly #onAssistChange: ((hasAssist: boolean) => void) | undefined;
  readonly #drafts = new Map<string, string>();
  readonly #queue: DraftRequest[] = [];
  #promptDraft = "";
  #promptPending = false;
  #active: DraftRequest | undefined;
  #cursor = 0;
  #preferredHeight = minHeight;
  #assist: EditorAssist | undefined;

  constructor(options: EditorControllerOptions) {
    super();
    this.#regions = options.regions;
    this.#sendPrompt = options.sendPrompt ?? (async () => false);
    this.#onPromptAccepted = options.onPromptAccepted;
    this.#onAssistChange = options.onAssistChange;
  }

  snapshot(): EditorSnapshot {
    const active = this.#active;
    return {
      text: this.text(),
      cursor: this.#cursor,
      mode: active ? "draft" : "prompt",
      label: active?.request.label,
      destination: active?.request.destination,
      preferredHeight: this.#preferredHeight,
      assist: this.#assist,
    };
  }

  openDraft(request: DraftRequestOptions): Promise<DraftResult> {
    return new Promise<DraftResult>((resolve) => {
      const pending: DraftRequest = { request, resolve, settled: false };
      if (request.signal) {
        if (request.signal.aborted) {
          pending.settled = true;
          resolve({ status: "cancelled" });
          return;
        }
        pending.onAbort = () => this.#settle(pending, { status: "cancelled" });
        request.signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      this.#queue.push(pending);
      this.#startNext();
      this.changed();
    });
  }

  requestFocus(target: EditorFocusTarget): void {
    this.#regions.requestFocus(target);
  }

  setText(text: string, cursor = text.length): void {
    const active = this.#active;
    if (active) {
      if (this.#drafts.get(active.request.destination) === text) {
        return;
      }
      this.#drafts.set(active.request.destination, text);
    } else {
      if (this.#promptDraft === text) {
        return;
      }
      this.#promptDraft = text;
    }
    this.#cursor = cursor;
    this.changed();
  }

  /** Cursor position from the adapter; kept for the snapshot, not per draft. */
  setCursor(cursor: number): void {
    if (cursor === this.#cursor) {
      return;
    }
    this.#cursor = cursor;
    this.changed();
  }

  reportHeight(preferred: number): void {
    const next = Math.max(minHeight, Math.min(maxHeight, preferred));
    if (next === this.#preferredHeight) {
      return;
    }
    this.#preferredHeight = next;
    this.changed();
  }

  setAssist(assist: EditorAssist | undefined): void {
    if (sameAssist(this.#assist, assist)) {
      return;
    }
    this.#assist = assist;
    this.#onAssistChange?.((assist?.items.length ?? 0) > 0);
    this.changed();
  }

  text(): string {
    const active = this.#active;
    return active ? (this.#drafts.get(active.request.destination) ?? "") : this.#promptDraft;
  }

  activeDraft(): boolean {
    return this.#active !== undefined;
  }

  /**
   * Submit the prompt draft through the session. Only an accepted prompt clears
   * the draft and notifies the active stage requester; a rejected one is kept.
   */
  async submitPrompt(): Promise<boolean> {
    if (this.#active || this.#promptPending) {
      return false;
    }
    const text = this.#promptDraft.trim();
    if (text.length === 0) {
      return false;
    }
    this.#promptPending = true;
    let accepted = false;
    try {
      accepted = await this.#sendPrompt(text);
    } catch {
      accepted = false;
    } finally {
      this.#promptPending = false;
    }
    if (!accepted) {
      return false;
    }
    // Clearing waits for the in-flight edit to settle, but the requester is told
    // about every accepted send regardless of what the draft holds now.
    if (this.#promptDraft.trim() === text) {
      this.#promptDraft = "";
      this.#cursor = 0;
      this.changed();
    }
    this.#notifyPromptAccepted(text);
    return true;
  }

  #notifyPromptAccepted(text: string): void {
    if (!this.#onPromptAccepted) {
      return;
    }
    try {
      const result = this.#onPromptAccepted(text);
      if (result && typeof (result as Promise<void>).then === "function") {
        void (result as Promise<void>).catch(() => {});
      }
    } catch {
      // A requester callback never changes whether the session accepted the prompt.
    }
  }

  /** Complete the active draft as submitted; the draft is retained. */
  submitDraft(): boolean {
    const active = this.#active;
    return active ? this.#settle(active, { status: "submitted", text: this.text() }) : false;
  }

  /** Complete the active draft as cancelled; the draft is retained. */
  cancelDraft(): boolean {
    const active = this.#active;
    return active ? this.#settle(active, { status: "cancelled" }) : false;
  }

  #startNext(): void {
    if (this.#active) {
      return;
    }
    while (this.#queue.length > 0) {
      const pending = this.#queue.shift() as DraftRequest;
      if (pending.settled) {
        continue;
      }
      const { destination, initialText } = pending.request;
      if (!this.#drafts.has(destination)) {
        this.#drafts.set(destination, initialText ?? "");
      }
      this.#active = pending;
      this.#cursor = this.text().length;
      this.setAssist(undefined);
      this.#regions.requestFocus(EDITOR_REGION);
      this.changed();
      return;
    }
  }

  #settle(pending: DraftRequest, result: DraftResult): boolean {
    if (pending.settled) {
      return false;
    }
    pending.settled = true;
    if (pending.onAbort && pending.request.signal) {
      pending.request.signal.removeEventListener("abort", pending.onAbort);
    }
    if (this.#active === pending) {
      this.#active = undefined;
      this.#cursor = this.text().length;
      this.setAssist(undefined);
      pending.resolve(result);
      if (!this.#regions.requestFocus(pending.request.requester)) {
        this.#regions.requestFocus(EDITOR_REGION);
      }
      // Let the requester react before the next draft takes the editor.
      queueMicrotask(() => this.#startNext());
    } else {
      const index = this.#queue.indexOf(pending);
      if (index !== -1) {
        this.#queue.splice(index, 1);
      }
      pending.resolve(result);
    }
    this.changed();
    return true;
  }
}
