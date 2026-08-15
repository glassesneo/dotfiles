import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export async function withTemporaryRoot(prefix: string, run: (root: string) => Promise<void>): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), prefix));
    try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

export function extensionContext(options: {
    cwd?: string;
    mode: ExtensionContext["mode"];
    hasUI: boolean;
    ui?: Partial<ExtensionUIContext>;
}): ExtensionContext {
    const unexpected = () => {
        throw new Error("Unexpected UI call");
    };
    return {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        mode: options.mode,
        hasUI: options.hasUI,
        ui: {
            select: unexpected,
            input: unexpected,
            editor: unexpected,
            notify: unexpected,
            custom: unexpected,
            ...options.ui,
        } as ExtensionUIContext,
    } as ExtensionContext;
}

export class FakeMonotonicTimers {
    now = 0;
    private nextId = 1;
    private readonly timers = new Map<number, { due: number; callback: () => void | Promise<void> }>();

    readonly setTimeout = (callback: () => void | Promise<void>, delayMs: number): number => {
        const id = this.nextId++;
        this.timers.set(id, { due: this.now + Math.max(0, delayMs), callback });
        return id;
    };
    readonly clearTimeout = (timer: unknown): void => { this.timers.delete(Number(timer)); };
    get pendingCount(): number { return this.timers.size; }
    nextDelay(): number | undefined { const due = Math.min(...[...this.timers.values()].map(timer => timer.due)); return Number.isFinite(due) ? Math.max(0, due - this.now) : undefined; }
    captureNextCallback(): (() => void | Promise<void>) | undefined { return [...this.timers.values()].sort((left, right) => left.due - right.due)[0]?.callback; }

    async advance(milliseconds: number): Promise<void> {
        const target = this.now + milliseconds;
        while (true) {
            const next = [...this.timers.entries()].filter(([, timer]) => timer.due <= target).sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0];
            if (!next) break;
            const [id, timer] = next;
            this.timers.delete(id);
            this.now = timer.due;
            await timer.callback();
            await yieldToIO();
        }
        this.now = target;
        await yieldToIO();
    }
}

export async function yieldToIO(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
}

export async function eventually(predicate: () => boolean | Promise<boolean>, attempts = 1_000): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await predicate()) return;
        await yieldToIO();
    }
    assert.fail(`Condition was not met after ${attempts} event-loop turns`);
}

export async function settleWithinEventLoopTurns<T>(promise: Promise<T>, attempts = 200): Promise<T> {
    let outcome: { value: T } | { error: unknown } | undefined;
    void promise.then(value => { outcome = { value }; }, error => { outcome = { error }; });
    await eventually(() => outcome !== undefined, attempts);
    const settled = outcome;
    if (settled === undefined) assert.fail("Promise outcome was not captured");
    if ("error" in settled) throw settled.error;
    return settled.value;
}

export function textResult(content: { type: string; text?: string }): string {
    assert.equal(content.type, "text");
    assert.equal(typeof content.text, "string");
    return content.text as string;
}
