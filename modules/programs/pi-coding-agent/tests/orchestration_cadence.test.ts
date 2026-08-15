import assert from "node:assert/strict";
import test from "node:test";
import { OrchestrationDeadlineScheduler } from "../extensions_src/utilities/orchestration_cadence.ts";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

// Admission: deadline behavior is repository-owned runtime concurrency; TypeScript cannot detect overlap, missed-interval replay, or shutdown races.
// Given a late blocked deadline, when scheduling and shutdown cross the cadence boundary, the runtime observes one in-flight pass, skips missed repetitions, and awaits quiescence.
void test("deadline scheduler prevents overlap, skips missed intervals, and fences shutdown", async () => {
    let now = 0;
    let scheduled: (() => void | Promise<void>) | undefined;
    let scheduledDelay = -1;
    let release!: () => void;
    let runs = 0;
    let active = 0;
    let maximumActive = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const scheduler = new OrchestrationDeadlineScheduler({
        now: () => now,
        setTimeout(callback, delay) { scheduled = callback; scheduledDelay = delay; return callback; },
        clearTimeout() {},
    });
    scheduler.add("root", 100, async () => { runs += 1; active += 1; maximumActive = Math.max(maximumActive, active); await gate; active -= 1; }, { immediate: true });
    scheduler.start();
    assert.equal(scheduledDelay, 0);
    void scheduled!();
    await flush();
    assert.equal(runs, 1);

    now = 350;
    void scheduled!();
    await flush();
    assert.equal(runs, 1);
    assert.equal(maximumActive, 1);
    const stopping = scheduler.stop();
    await flush();
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await flush();
    assert.equal(stopped, false);
    release();
    await stopping;
    assert.equal(runs, 1);
});

// Given independent named deadlines, when the event loop arrives late, each due responsibility runs once and advances to its next future deadline.
void test("deadline scheduler keeps independent deadlines without replay", async () => {
    let now = 0;
    let scheduled: (() => void | Promise<void>) | undefined;
    let delay = -1;
    const runs: string[] = [];
    const scheduler = new OrchestrationDeadlineScheduler({ now: () => now, setTimeout(callback, value) { scheduled = callback; delay = value; return callback; }, clearTimeout() {} });
    scheduler.add("materialize", 1000, () => { runs.push("materialize"); });
    scheduler.add("delivery", 2000, () => { runs.push("delivery"); });
    scheduler.start();
    assert.equal(delay, 1000);
    now = 5000;
    await scheduled!();
    await flush();
    assert.deepEqual(runs, ["materialize", "delivery"]);
    assert.equal(delay, 1000);
    await scheduler.stop();
});
