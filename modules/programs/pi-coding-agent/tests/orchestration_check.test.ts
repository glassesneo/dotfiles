import assert from "node:assert/strict";
import test from "node:test";
import { runCheck, type CheckChild, type CheckSpawner } from "../scripts/run-check.mts";

class FakeChild implements CheckChild {
    private errorListener: ((error: Error) => void) | undefined;
    private exitListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;

    once(event: "error", listener: (error: Error) => void): this;
    once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
    once(event: "error" | "exit", listener: ((error: Error) => void) | ((code: number | null, signal: NodeJS.Signals | null) => void)): this {
        if (event === "error") this.errorListener = listener as (error: Error) => void;
        else this.exitListener = listener as (code: number | null, signal: NodeJS.Signals | null) => void;
        return this;
    }

    finish(outcome: number | Error): void {
        if (outcome instanceof Error) this.errorListener?.(outcome);
        else this.exitListener?.(outcome, null);
    }
}

function fakeSpawner(outcomes: readonly (number | Error)[]) {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    let index = 0;
    const spawn: CheckSpawner = (command, args) => {
        const child = new FakeChild();
        calls.push({ command, args });
        queueMicrotask(() => { child.finish(outcomes[index++] ?? 0); });
        return child;
    };
    return { calls, spawn };
}

// Admission: a scoped check that launches the wrong commands wastes developer time or silently skips orchestration validation; typecheck and lint cannot observe runner process selection.
// Given a check scope at the spawn boundary, callers observe the selected commands, unknown-scope rejection before launch, and child failure as a failed check.
void test("default scope preserves the complete check commands", async () => {
    const fake = fakeSpawner([0, 0, 0]);

    assert.equal(await runCheck([], fake.spawn), true);
    assert.deepEqual(fake.calls, [
        { command: "pnpm", args: ["run", "typecheck"] },
        { command: "pnpm", args: ["run", "lint"] },
        { command: "pnpm", args: ["run", "test"] },
    ]);
});

void test("orchestration scope selects focused commands through the spawn boundary", async () => {
    const fake = fakeSpawner([0, 0, 0]);

    assert.equal(await runCheck(["orchestration"], fake.spawn), true);
    assert.deepEqual(fake.calls, [
        { command: "pnpm", args: ["run", "typecheck"] },
        { command: "pnpm", args: ["run", "lint:orchestration"] },
        { command: "pnpm", args: ["run", "test:orchestration"] },
    ]);
});

void test("unknown scope rejects before spawning", async () => {
    const fake = fakeSpawner([]);

    await assert.rejects(runCheck(["mesh"], fake.spawn), /Unknown check scope/u);
    assert.deepEqual(fake.calls, []);
});

void test("a focused command failure propagates to the check result", async () => {
    const fake = fakeSpawner([0, 1, 0]);

    assert.equal(await runCheck(["orchestration"], fake.spawn), false);
});
