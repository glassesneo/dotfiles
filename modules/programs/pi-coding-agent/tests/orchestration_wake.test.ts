import assert from "node:assert/strict";
import test from "node:test";
import { createDirectoryWake, type DirectoryWatcher, type WatchDirectory } from "../extensions_src/utilities/orchestration_wake.ts";
import { FakeMonotonicTimers, yieldToIO } from "./test_helpers.ts";

class FakeWatcher implements DirectoryWatcher {
    closed = false;
    unrefed = false;
    private errorListener: ((error: Error) => void) | undefined;
    readonly options: { persistent?: boolean };
    constructor(options: { persistent?: boolean }) { this.options = options; }
    close(): void { this.closed = true; }
    on(_event: "error", listener: (error: Error) => void): this { this.errorListener = listener; return this; }
    unref(): void { this.unrefed = true; }
    error(error: Error): void { this.errorListener?.(error); }
}

function harness(clock = new FakeMonotonicTimers()) {
    const watchers: FakeWatcher[] = []; const listeners: Array<(eventType: string, filename: string | Buffer | null) => void> = [];
    const watch: WatchDirectory = (_path, options, listener) => { const watcher = new FakeWatcher(options); watchers.push(watcher); listeners.push(listener); return watcher; };
    return { clock, watchers, listeners, dependencies: { watch, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout } };
}

// Admission: watcher callbacks are advisory process behavior; types cannot detect a lost immediate pass, overlapping passes, stale rearm, or a referenced watcher keeping a worker alive.
// Given directory changes and watcher failures, the wake boundary coalesces immediate passes, rearms safely, and closes every non-persistent watcher without making fallback polling depend on callbacks.
void test("directory wake coalesces non-overlapping passes, rearms, and closes without process liveness", async () => {
    const fake = harness(); let runs = 0; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const errors: string[] = [];
    const wake = await createDirectoryWake({ directory: "/tmp/synthetic-mesh-wake", debounceMs: 5, rearmMs: 7, run: async () => { runs += 1; if (runs === 1) await gate; }, onError: error => errors.push((error as Error).message), dependencies: fake.dependencies });
    assert.equal(fake.watchers.length, 1); assert.equal(fake.watchers[0]!.options.persistent, false); assert.equal(fake.watchers[0]!.unrefed, true);
    fake.listeners[0]!("change", "one.json"); fake.listeners[0]!("change", "two.json"); const firstAdvance = fake.clock.advance(5); await yieldToIO(); assert.equal(runs, 1);
    fake.listeners[0]!("change", "three.json"); await yieldToIO(); assert.equal(runs, 1);
    release(); await firstAdvance; await fake.clock.advance(5); assert.equal(runs, 2);
    fake.listeners[0]!("rename", null); assert.equal(fake.watchers[0]!.closed, false); await fake.clock.advance(7); assert.equal(fake.watchers[0]!.closed, true); assert.equal(fake.watchers.length, 2);
    fake.watchers[1]!.error(new Error("watch failed")); assert.deepEqual(errors, ["watch failed"]); await fake.clock.advance(7); assert.equal(fake.watchers.length, 3);
    const stale = fake.listeners[1]!; await wake.close(); assert.equal(fake.watchers[2]!.closed, true); stale("change", "stale.json"); await fake.clock.advance(100); assert.equal(runs, 4); assert.equal(fake.clock.pendingCount, 0);
});

// Given a healthy callback, the consumer receives an immediate debounced pass; given no callback, no pass occurs and the independent polling owner remains responsible for correctness.
void test("directory wake is an immediate hint and suppressed callbacks remain inert", async () => {
    const fake = harness(); let runs = 0;
    const wake = await createDirectoryWake({ directory: "/tmp/synthetic-mesh-wake-suppressed", debounceMs: 0, run: () => { runs += 1; }, onError: error => assert.fail(String(error)), dependencies: fake.dependencies });
    await fake.clock.advance(10_000); assert.equal(runs, 0);
    fake.listeners[0]!("change", "task.json"); await fake.clock.advance(0); assert.equal(runs, 1);
    await wake.close();
});
