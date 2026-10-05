/**
 * Terminal-independent UI controllers: the region/focus model, the key and
 * type registries, the blocking stage queue, and the structured timeline store.
 * Nothing here imports OpenTUI, Solid, or a terminal; the view layer renders
 * these controllers' snapshots and calls back into them.
 */

export type RegionId = string;

/** A registration handle; `dispose` removes exactly this registration's effect. */
export interface Registration {
  dispose(): void;
}

export type RegistrationCategory = "item" | "stage";

export class DuplicateRegistrationError extends Error {
  constructor(
    readonly category: RegistrationCategory,
    readonly registrationName: string,
  ) {
    super(`duplicate ${category} registration: ${registrationName}`);
    this.name = "DuplicateRegistrationError";
  }
}

function notify(listeners: ReadonlySet<() => void>): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Shared listener plumbing; controllers expose `subscribe` and call `changed`. */
export class Emitter {
  readonly #listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  protected changed(): void {
    notify(this.#listeners);
  }
}

// ---------------------------------------------------------------------------
// Regions and focus
// ---------------------------------------------------------------------------

export const DEFAULT_REGIONS: readonly RegionId[] = ["timeline", "stage", "editor"];
export const EDITOR_REGION: RegionId = "editor";

interface RegionState {
  id: RegionId;
  available: boolean;
  fallback: RegionId | undefined;
}

export interface RegionControllerOptions {
  regions?: readonly RegionId[];
  fallback?: RegionId;
  keys?: KeyRegistry;
}

/**
 * The only source of focus truth. Regions are held in an array and looked up by
 * id, so the set is variable and no consumer encodes the three names as a union
 * or three booleans. `stage` becomes unavailable while it is empty, which
 * is what makes a focus request to an empty stage fail.
 */
export class RegionController extends Emitter {
  readonly #regions: RegionState[] = [];
  readonly #keys: KeyRegistry | undefined;
  #focused: RegionId;
  readonly #fallback: RegionId;

  constructor(options: RegionControllerOptions = {}) {
    super();
    this.#keys = options.keys;
    this.#fallback = options.fallback ?? EDITOR_REGION;
    for (const id of options.regions ?? DEFAULT_REGIONS) {
      this.#regions.push({ id, available: true, fallback: undefined });
    }
    const known = this.#regions.map((region) => region.id);
    this.#focused = known.includes(this.#fallback)
      ? this.#fallback
      : (known[0] ?? this.#fallback);
  }

  current(): RegionId {
    return this.#focused;
  }

  /** Focus an existing, available region; an unavailable region leaves focus alone. */
  requestFocus(region: RegionId): boolean {
    const target = this.#regions.find((candidate) => candidate.id === region);
    if (!target || !target.available) {
      return false;
    }
    if (this.#focused !== region) {
      this.#focused = region;
      this.changed();
    }
    return true;
  }

  isAvailable(region: RegionId): boolean {
    return this.#regions.find((candidate) => candidate.id === region)?.available ?? false;
  }

  /** Toggle availability; if the focused region becomes unavailable, move it. */
  setAvailable(region: RegionId, available: boolean): void {
    const target = this.#regions.find((candidate) => candidate.id === region);
    if (!target || target.available === available) {
      return;
    }
    target.available = available;
    if (!available && this.#focused === region) {
      this.#focused = this.#fallbackFor(region);
    }
    this.changed();
  }

  list(): readonly RegionId[] {
    return this.#regions.map((region) => region.id);
  }

  /** Register an additional region. Not exposed through `HarnessUI`. */
  register(region: RegionId, options: { fallback?: RegionId; available?: boolean } = {}): Registration {
    if (this.#regions.some((candidate) => candidate.id === region)) {
      throw new Error(`region already registered: ${region}`);
    }
    const state: RegionState = {
      id: region,
      available: options.available ?? true,
      fallback: options.fallback,
    };
    this.#regions.push(state);
    this.changed();
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        // Match by identity so a stale handle cannot remove a re-registration.
        const index = this.#regions.indexOf(state);
        if (index === -1) {
          return;
        }
        this.#regions.splice(index, 1);
        if (this.#focused === region) {
          this.#focused = this.#resolveFallback(region, state.fallback);
        }
        this.changed();
      },
    };
  }

  resolve(key: KeyChord): (() => void) | undefined {
    return this.#keys?.resolve(this.#focused, key);
  }

  #fallbackFor(region: RegionId): RegionId {
    const explicit = this.#regions.find((candidate) => candidate.id === region)?.fallback;
    return this.#resolveFallback(region, explicit);
  }

  #resolveFallback(region: RegionId, explicit: RegionId | undefined): RegionId {
    for (const candidate of [explicit, this.#fallback]) {
      if (
        candidate &&
        candidate !== region &&
        this.#regions.some((state) => state.id === candidate && state.available)
      ) {
        return candidate;
      }
    }
    return this.#regions.find((state) => state.available)?.id ?? this.#focused;
  }
}

// ---------------------------------------------------------------------------
// Key registry
// ---------------------------------------------------------------------------

export interface KeyChord {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyBinding extends KeyChord {
  /** Stable `region.action` identifier used by configuration. */
  actionId: string;
  action: () => void;
  /**
   * When this returns false the chord is skipped and the key falls through to
   * the focused renderable, so a native input can type it. Collision detection
   * ignores the predicate and still rejects the batch.
   */
  when?: () => boolean;
}

export class DuplicateKeyBindingError extends Error {
  constructor(
    readonly region: RegionId,
    readonly chord: string,
  ) {
    super(`duplicate key binding in region ${region}: ${chord}`);
    this.name = "DuplicateKeyBindingError";
  }
}

function chordId(chord: KeyChord): string {
  return `${chord.name}|${chord.ctrl ? 1 : 0}|${chord.shift ? 1 : 0}|${chord.alt ? 1 : 0}`;
}

interface BindingEntry {
  registration: number;
  contribution: string;
  actionId: string;
  action: () => void;
  when?: () => boolean;
}

/**
 * Per-region key bindings. A batch is rejected atomically when any chord
 * collides with an active binding in the same region or repeats inside the
 * batch; the same chord in another region is allowed.
 */
export class KeyRegistry extends Emitter {
  readonly #byRegion = new Map<RegionId, Map<string, BindingEntry>>();
  #nextRegistration = 0;

  register(contribution: string, region: RegionId, bindings: readonly KeyBinding[]): Registration {
    const table = this.#byRegion.get(region);
    const batch = new Set<string>();
    for (const binding of bindings) {
      const id = chordId(binding);
      if (batch.has(id)) {
        throw new DuplicateKeyBindingError(region, id);
      }
      batch.add(id);
      if (table?.has(id)) {
        throw new DuplicateKeyBindingError(region, id);
      }
    }
    const registration = this.#nextRegistration++;
    const target = table ?? new Map<string, BindingEntry>();
    if (!table) {
      this.#byRegion.set(region, target);
    }
    for (const binding of bindings) {
      target.set(chordId(binding), {
        registration,
        contribution,
        actionId: binding.actionId,
        action: binding.action,
        when: binding.when,
      });
    }
    this.changed();
    return {
      dispose: () => {
        const current = this.#byRegion.get(region);
        if (!current) {
          return;
        }
        for (const [id, item] of current) {
          if (item.registration === registration) {
            current.delete(id);
          }
        }
        if (current.size === 0) {
          this.#byRegion.delete(region);
        }
        this.changed();
      },
    };
  }

  resolve(region: RegionId, key: KeyChord): (() => void) | undefined {
    const item = this.#byRegion.get(region)?.get(chordId(key));
    if (!item || (item.when && !item.when())) {
      return undefined;
    }
    return item.action;
  }
}

// ---------------------------------------------------------------------------
// Stage queue
// ---------------------------------------------------------------------------

export interface StageContentType<T, Render = unknown> {
  kind: string;
  render(props: StageRenderProps<T, Render>): Render;
  /** Resolved value when the request is cancelled or its signal aborts. */
  defaultValue: T;
  actions?: Record<string, StageAction<T>>;
}

export interface StageRenderProps<T, Render = unknown> {
  value: T;
  handle: StageHandle<T>;
  preferredHeight: number;
  focused: boolean;
}

export interface StageAction<T> {
  (event: StageActionEvent<T>): void | Promise<void>;
}

export interface StageActionEvent<T> {
  value: T;
  handle: StageHandle<T>;
  focused: boolean;
}

export interface StageRequest<T, Render = unknown> {
  requester: string;
  type: StageContentType<T, Render>;
  value: T;
  preferredHeight: number;
  onPromptSubmitted?(event: { text: string; handle: StageHandle }): void | Promise<void>;
  signal?: AbortSignal;
}

export type StageResult<T> =
  | { status: "closed"; value: T }
  | { status: "cancelled"; value: T; reason?: string };

export interface StageHandle<T = unknown> {
  readonly id: string;
  readonly requester: string;
  value(): T;
  update(value: T): void;
  /** Complete normally with a chosen value, defaulting to the current one. */
  close(value?: T): void;
  /** Complete with the type's default value and an optional diagnostic reason. */
  cancel(reason?: string): void;
  readonly closed: Promise<StageResult<T>>;
}

/** The active stage request in the store's erased form, for a view to render. */
export interface StageEntry<Render = unknown> {
  readonly id: string;
  readonly requester: string;
  readonly kind: string;
  readonly preferredHeight: number;
  readonly focused: boolean;
  render(track?: () => void): Render;
  readonly actions: readonly string[];
  runAction(name: string): void | Promise<void>;
}

interface PendingStage<Render> {
  id: string;
  requester: string;
  kind: string;
  preferredHeight: number;
  actions: readonly string[];
  render: (track?: () => void) => Render;
  runAction: (name: string) => void | Promise<void>;
  onPromptSubmitted?: (event: { text: string; handle: StageHandle }) => void | Promise<void>;
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (result: StageResult<unknown>) => void;
  handle: StageHandle<unknown>;
  settled: boolean;
  returnFocus: RegionId | undefined;
}

export interface StageControllerOptions {
  regions: RegionController;
  region?: RegionId;
  /** Guards automatic focus claims; explicit `requestFocus` bypasses this. */
  canFocus?: () => boolean;
}

/**
 * One blocking stage request is shown at a time; the rest wait FIFO. While a
 * request is active the `stage` region is available and focused, and focus
 * returns to whatever held it when the request started.
 */
export class StageController<Render = unknown> extends Emitter {
  readonly #regions: RegionController;
  readonly #region: RegionId;
  readonly #canFocus: () => boolean;
  readonly #kinds = new Map<string, object>();
  readonly #queue: PendingStage<Render>[] = [];
  #active: PendingStage<Render> | undefined;
  #assistAvailable = false;
  #nextId = 0;

  constructor(options: StageControllerOptions) {
    super();
    this.#regions = options.regions;
    this.#region = options.region ?? "stage";
    this.#canFocus = options.canFocus ?? (() => true);
    this.#syncAvailability();
  }

  registerType<T>(type: StageContentType<T, Render>): Registration {
    if (this.#kinds.has(type.kind)) {
      throw new DuplicateRegistrationError("stage", type.kind);
    }
    const token = {};
    this.#kinds.set(type.kind, token);
    this.changed();
    return {
      dispose: () => {
        if (this.#kinds.get(type.kind) !== token) {
          return;
        }
        this.#kinds.delete(type.kind);
        this.changed();
      },
    };
  }

  show<T>(request: StageRequest<T, Render>): StageHandle<T> {
    const id = `stage-${this.#nextId++}`;
    let current: T = request.value;
    let resolve!: (result: StageResult<T>) => void;
    const closed = new Promise<StageResult<T>>((settle) => {
      resolve = settle;
    });

    let pending!: PendingStage<Render>;
    const handle: StageHandle<unknown> = {
      id,
      requester: request.requester,
      value: () => current,
      update: (value) => {
        if (pending.settled) return;
        current = value as T;
        this.changed();
      },
      close: (value) =>
        this.#settle(pending, {
          status: "closed",
          value: value === undefined ? current : (value as T),
        }),
      cancel: (reason) =>
        this.#settle(pending, {
          status: "cancelled",
          value: request.type.defaultValue,
          reason,
        }),
      closed,
    };

    pending = {
      id,
      requester: request.requester,
      kind: request.type.kind,
      preferredHeight: request.preferredHeight,
      actions: request.type.actions ? Object.keys(request.type.actions) : [],
      render: (track) => {
        const focused = () => this.focused();
        return request.type.render({
          get value() { track?.(); return current; },
          handle: handle as StageHandle<T>,
          preferredHeight: request.preferredHeight,
          get focused() { track?.(); return focused(); },
        });
      },
      runAction: (name) => {
        if (pending.settled) return;
        const action = request.type.actions?.[name];
        return action
          ? action({ value: current, handle: handle as StageHandle<T>, focused: this.focused() })
          : undefined;
      },
      onPromptSubmitted: request.onPromptSubmitted,
      signal: request.signal,
      resolve: (result) => resolve(result as StageResult<T>),
      handle,
      settled: false,
      returnFocus: undefined,
    };

    if (request.signal) {
      if (request.signal.aborted) {
        this.#settle(pending, {
          status: "cancelled",
          value: request.type.defaultValue,
          reason: "aborted",
        });
        return handle as StageHandle<T>;
      }
      pending.onAbort = () =>
        this.#settle(pending, {
          status: "cancelled",
          value: request.type.defaultValue,
          reason: "aborted",
        });
      request.signal.addEventListener("abort", pending.onAbort, { once: true });
    }

    this.#queue.push(pending);
    this.#startNext();
    this.changed();
    return handle as StageHandle<T>;
  }

  active(): StageEntry<Render> | undefined {
    const pending = this.#active;
    if (!pending) {
      return undefined;
    }
    return {
      id: pending.id,
      requester: pending.requester,
      kind: pending.kind,
      preferredHeight: pending.preferredHeight,
      focused: this.focused(),
      render: pending.render,
      actions: pending.actions,
      runAction: pending.runAction,
    };
  }

  hasActive(): boolean {
    return this.#active !== undefined;
  }

  queued(): number {
    return this.#queue.length;
  }

  focused(): boolean {
    return this.#regions.current() === this.#region;
  }

  async notifyPromptSubmitted(text: string): Promise<void> {
    const active = this.#active;
    if (!active?.onPromptSubmitted) {
      return;
    }
    try {
      await active.onPromptSubmitted({ text, handle: active.handle });
    } catch {
      // A requester callback never changes the prompt result or escapes unhandled.
    }
  }

  /**
   * Availability contributed by a transient editor assist. The region stays
   * focusable while either a request or a nonempty assist owns it.
   */
  setAssistAvailable(available: boolean): void {
    if (this.#assistAvailable === available) {
      return;
    }
    this.#assistAvailable = available;
    this.#syncAvailability();
    this.changed();
  }

  #startNext(): void {
    if (this.#active) {
      return;
    }
    while (this.#queue.length > 0) {
      const next = this.#queue.shift() as PendingStage<Render>;
      if (next.settled) {
        continue;
      }
      next.returnFocus = this.#regions.current();
      this.#active = next;
      this.#syncAvailability();
      if (this.#canFocus()) {
        this.#regions.requestFocus(this.#region);
      }
      this.changed();
      return;
    }
    this.#syncAvailability();
  }

  #settle(pending: PendingStage<Render>, result: StageResult<unknown>): void {
    if (pending.settled) {
      return;
    }
    pending.settled = true;
    if (pending.onAbort && pending.signal) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    if (this.#active === pending) {
      this.#active = undefined;
      pending.resolve(result);
      if (this.#canFocus()) {
        if (!this.#regions.requestFocus(pending.returnFocus ?? EDITOR_REGION)) {
          this.#regions.requestFocus(EDITOR_REGION);
        }
      }
      // Let the requester react before the next request takes the stage.
      queueMicrotask(() => this.#startNext());
    } else {
      const index = this.#queue.indexOf(pending);
      if (index !== -1) {
        this.#queue.splice(index, 1);
      }
      pending.resolve(result);
    }
    this.#syncAvailability();
    this.changed();
  }

  #syncAvailability(): void {
    this.#regions.setAvailable(this.#region, this.#active !== undefined || this.#assistAvailable);
  }
}

// ---------------------------------------------------------------------------
// Structured timeline
// ---------------------------------------------------------------------------

export interface TimelineItemInput<T, Render = unknown> {
  id: string;
  version: number;
  type: ItemType<T, Render>;
  value: T;
}

export interface ItemType<T, Render = unknown> {
  kind: string;
  render(props: ItemRenderProps<T, Render>): Render;
  sourceText(value: T): string;
  actions: Record<string, ItemAction<T>>;
}

export interface ItemRenderProps<T, Render = unknown> {
  value: T;
  id: string;
  version: number;
}

export interface ItemAction<T> {
  (event: ItemActionEvent<T>): void | Promise<void>;
}

export interface ItemActionEvent<T> {
  value: T;
  id: string;
}

export interface ItemFactory<T, Render = unknown> extends Registration {
  readonly kind: string;
  create(value: T): TimelineItemInput<T, Render>;
}

/**
 * The stored form of a timeline item: its typed render/source/action are
 * captured in closures so `T` stays internal and never leaks as `any`.
 */
export interface TimelineItem<Render = unknown> {
  readonly id: string;
  readonly version: number;
  readonly kind: string;
  render(): Render;
  sourceText(): string;
  readonly actions: readonly string[];
  runAction(name: string): void | Promise<void>;
}

export function materializeItem<T, Render>(input: TimelineItemInput<T, Render>): TimelineItem<Render> {
  const { id, version, type, value } = input;
  return {
    id,
    version,
    kind: type.kind,
    render: () => type.render({ value, id, version }),
    sourceText: () => type.sourceText(value),
    actions: Object.keys(type.actions),
    runAction: async (name) => {
      const action = type.actions[name];
      if (action) {
        await action({ value, id });
      }
    },
  };
}

/**
 * Selectable timeline items in append order. `append` replaces by id so a
 * streamed item keeps its identity; `replace` reconciles a whole history and
 * moves the cursor to the nearest surviving item.
 */
export class ItemTypeRegistry<Render = unknown> extends Emitter {
  readonly #kinds = new Map<string, object>();
  readonly #items: TimelineItem<Render>[] = [];
  readonly #indexById = new Map<string, number>();
  #cursor: string | undefined;
  #nextId = 0;

  registerType<T>(type: ItemType<T, Render>): ItemFactory<T, Render> {
    if (this.#kinds.has(type.kind)) {
      throw new DuplicateRegistrationError("item", type.kind);
    }
    const token = {};
    this.#kinds.set(type.kind, token);
    this.changed();
    return {
      kind: type.kind,
      create: (value: T) => ({
        id: `timeline-${this.#nextId++}`,
        version: 0,
        type,
        value,
      }),
      dispose: () => {
        if (this.#kinds.get(type.kind) !== token) {
          return;
        }
        this.#kinds.delete(type.kind);
        this.changed();
      },
    };
  }

  append<T>(input: TimelineItemInput<T, Render>): TimelineItem<Render> {
    const item = materializeItem(input);
    const index = this.#indexById.get(item.id);
    if (index === undefined) {
      this.#indexById.set(item.id, this.#items.length);
      this.#items.push(item);
      if (this.#cursor === undefined) {
        this.#cursor = item.id;
      }
    } else {
      this.#items[index] = item;
    }
    this.changed();
    return item;
  }

  /** Replace all items, keeping a surviving cursor or moving it to a nearby item. */
  replace(items: readonly TimelineItem<Render>[]): void {
    const previousIndex =
      this.#cursor === undefined ? undefined : this.#indexById.get(this.#cursor);
    this.#items.length = 0;
    this.#indexById.clear();
    for (const item of items) {
      this.#indexById.set(item.id, this.#items.length);
      this.#items.push(item);
    }
    if (this.#cursor === undefined || !this.#indexById.has(this.#cursor)) {
      if (previousIndex !== undefined) {
        // Fall back to the exact prior index: previous item, then next, then no cursor.
        const previous = previousIndex > 0 ? items[previousIndex - 1] : undefined;
        const next = items[previousIndex];
        this.#cursor = previous?.id ?? next?.id;
      } else {
        this.#cursor = items[0]?.id;
      }
    }
    this.changed();
  }

  items(): readonly TimelineItem<Render>[] {
    return this.#items;
  }

  find(id: string): TimelineItem<Render> | undefined {
    const index = this.#indexById.get(id);
    return index === undefined ? undefined : this.#items[index];
  }

  cursor(): string | undefined {
    return this.#cursor;
  }

  currentItem(): TimelineItem<Render> | undefined {
    return this.#cursor === undefined ? undefined : this.find(this.#cursor);
  }

  setCursor(id: string): boolean {
    if (!this.#indexById.has(id)) {
      return false;
    }
    if (this.#cursor !== id) {
      this.#cursor = id;
      this.changed();
    }
    return true;
  }

  /** Move the cursor by `delta`, clamped to the list; choose an end if unset. */
  moveCursor(delta: number): void {
    if (this.#items.length === 0) {
      return;
    }
    const current = this.#cursor === undefined ? undefined : this.#indexById.get(this.#cursor);
    const base = current ?? (delta < 0 ? this.#items.length : -1);
    const next = Math.max(0, Math.min(this.#items.length - 1, base + delta));
    const id = this.#items[next]?.id;
    if (id !== undefined && id !== this.#cursor) {
      this.#cursor = id;
      this.changed();
    }
  }
}
