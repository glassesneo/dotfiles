/**
 * Cursor movement, smooth scrolling, and clipboard for the structured timeline. The
 * service never touches focus: the screen owns the focused region and calls
 * these actions, so `j`/`k` scroll the scrollbox that the view exposes while
 * the screen keeps the native focus.
 */
import {
  type HostClipboardService,
  type RendererClipboardBoundary,
  type Timeline,
  createHostClipboard,
  createRendererClipboardAdapter,
  createTimeline,
  engine,
} from "@opentui/core";
import type { NoticeLevel } from "../core/session-entries";
import type { ItemTypeRegistry } from "./controllers";

export const ITEM_SCROLL_DURATION_MS = 120;

export type ItemScrollKind = "page-down" | "page-up" | "half-down" | "half-up";

/** The part of a ScrollBoxRenderable the actions need. */
export interface ItemRow {
  readonly y: number;
  readonly height: number;
}

export interface TimelineScrollBox {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly height: number;
  readonly y: number;
  getRenderable(id: string): ItemRow | undefined;
}

export interface ClipboardWriter {
  /** True when a backend accepted the text; false when none could. */
  writeText(text: string): Promise<boolean>;
  dispose(): Promise<void>;
}

export interface ItemActions<Render = unknown> {
  /** Move the cursor one item and bring it clear of the overlay. */
  move(delta: number): void;
  /** Page or half-page scroll, interpolated over the configured duration. */
  scroll(kind: ItemScrollKind): void;
  /** Copy the cursor item's `sourceText()` to the clipboard. */
  copy(): Promise<boolean>;
  dispose(): Promise<void>;
}

export interface ItemActionsOptions<Render = unknown> {
  timeline: ItemTypeRegistry<Render>;
  scrollbox: () => TimelineScrollBox | undefined;
  /** Rows the editor and stage cover over the scrollbox's bottom edge. */
  overlayHeight: () => number;
  /** Overrides the native clipboard; used by tests and non-terminal hosts. */
  clipboard?: ClipboardWriter;
  /** The renderer whose OSC52 API is the clipboard fallback. */
  renderer?: RendererClipboardBoundary;
  notify?: (level: NoticeLevel, text: string) => void;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * The real clipboard: the host service first, and the renderer's OSC52 when the
 * host has no native backend. "Attempted" OSC52 counts because the terminal
 * cannot confirm delivery; only both failing is a failure.
 */
export function createNativeClipboard(renderer: RendererClipboardBoundary): ClipboardWriter {
  let host: HostClipboardService | undefined;
  try {
    host = createHostClipboard();
  } catch {
    host = undefined;
  }
  const terminal = createRendererClipboardAdapter(renderer);
  return {
    async writeText(text: string): Promise<boolean> {
      if (host) {
        try { if ((await host.writeText(text, { selection: "clipboard" })).status === "written") return true; }
        catch { /* The terminal backend is still available after host failure. */ }
      }
      return terminal.writeText(text, "clipboard").status === "attempted";
    },
    async dispose(): Promise<void> {
      await host?.dispose();
    },
  };
}

/**
 * Interpolates scrollTop toward a target with the native Timeline, which the
 * TimelineEngine drives on the renderer's own clock. The duration is fixed so
 * the design's 120 ms motion is the only behavior production can show.
 */
class SmoothScroll {
  readonly #scrollbox: () => TimelineScrollBox | undefined;
  #timeline: Timeline | undefined;
  #target: number | undefined;

  constructor(scrollbox: () => TimelineScrollBox | undefined) {
    this.#scrollbox = scrollbox;
  }

  /** The in-flight destination, so a repeated input keeps adding to it. */
  target(): number | undefined {
    return this.#timeline ? this.#target : undefined;
  }

  scrollTo(value: number): void {
    const box = this.#scrollbox();
    if (!box) {
      return;
    }
    const max = Math.max(0, box.scrollHeight - box.height);
    this.#target = Math.max(0, Math.min(max, value));
    this.#stop();
    const from = box.scrollTop;
    if (from === this.#target) {
      return;
    }
    const state = { top: from };
    let timeline!: Timeline;
    timeline = createTimeline({
      duration: ITEM_SCROLL_DURATION_MS,
      onComplete: () => {
        engine.unregister(timeline);
        if (this.#timeline === timeline) {
          this.#timeline = undefined;
          // The animation is over, so a manual scroll becomes the next base.
          this.#target = undefined;
        }
      },
    });
    timeline.add(state, {
      top: this.#target,
      duration: ITEM_SCROLL_DURATION_MS,
      ease: "outQuad",
      onUpdate: () => {
        const current = this.#scrollbox();
        if (current) {
          current.scrollTop = Math.round(state.top);
        }
      },
    });
    this.#timeline = timeline;
  }

  stop(): void {
    this.#stop();
  }

  #stop(): void {
    if (this.#timeline) {
      engine.unregister(this.#timeline);
      this.#timeline = undefined;
    }
  }
}

export function createItemActions<Render>(
  options: ItemActionsOptions<Render>,
): ItemActions<Render> {
  const { timeline, scrollbox, overlayHeight } = options;
  const notify = options.notify;
  const clipboard =
    options.clipboard ?? (options.renderer ? createNativeClipboard(options.renderer) : undefined);
  const scroll = new SmoothScroll(scrollbox);

  const visibleRows = (box: TimelineScrollBox): number =>
    Math.max(1, box.height - Math.max(0, overlayHeight()));

  return {
    move(delta: number): void {
      timeline.moveCursor(delta);
      const box = scrollbox();
      const id = timeline.cursor();
      if (!box || id === undefined) {
        return;
      }
      const row = box.getRenderable(id);
      if (!row) {
        return;
      }
      const visible = visibleRows(box);
      // Renderable coordinates include the current scroll translation.
      const top = row.y - box.y + box.scrollTop;
      let target = box.scrollTop;
      if (top < box.scrollTop) target = top;
      else if (top + row.height > box.scrollTop + visible) target = top + row.height - visible;
      scroll.scrollTo(target);
    },

    scroll(kind: ItemScrollKind): void {
      const box = scrollbox();
      if (!box) {
        return;
      }
      const visible = visibleRows(box);
      const amount =
        kind === "page-down" || kind === "page-up" ? visible : Math.max(1, Math.floor(visible / 2));
      const base = scroll.target() ?? box.scrollTop;
      scroll.scrollTo(base + (kind === "page-down" || kind === "half-down" ? amount : -amount));
    },

    async copy(): Promise<boolean> {
      const item = timeline.currentItem();
      if (!item) {
        return false;
      }
      if (!clipboard) {
        notify?.("error", "Clipboard is unavailable");
        return false;
      }
      try {
        const copied = await clipboard.writeText(item.sourceText());
        if (!copied) {
          notify?.("error", "Clipboard copy failed");
        }
        return copied;
      } catch (error) {
        notify?.("error", `Clipboard copy failed: ${asError(error).message}`);
        return false;
      }
    },

    dispose(): Promise<void> {
      scroll.stop();
      return clipboard?.dispose() ?? Promise.resolve();
    },
  };
}
