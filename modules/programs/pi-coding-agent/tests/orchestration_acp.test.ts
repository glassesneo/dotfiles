import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { AcpTransport } from "../extensions_src/utilities/orchestration_acp.ts";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { eventually, yieldToIO } from "./test_helpers.ts";

interface FakeProcessBehavior {
    ignoreTerm?: boolean;
    killExitDelayMs?: number;
    neverExit?: boolean;
}

function fakeAcpProcess(behavior: FakeProcessBehavior = {}): ChildProcessWithoutNullStreams & { signals: NodeJS.Signals[]; stdoutStream: PassThrough } {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stderr.setEncoding("utf8");
    const emitter = new EventEmitter();
    let exitCode: number | null = null;
    let signalCode: NodeJS.Signals | null = null;
    const signals: NodeJS.Signals[] = [];
    const processLike = {
        stdin,
        stdout,
        stderr,
        signals,
        stdoutStream: stdout,
        get exitCode() { return exitCode; },
        get signalCode() { return signalCode; },
        kill(signal: NodeJS.Signals) {
            signals.push(signal);
            if (signal === "SIGTERM" && behavior.ignoreTerm) return true;
            if (behavior.neverExit) return true;
            const delay = signal === "SIGKILL" ? behavior.killExitDelayMs ?? 0 : 0;
            setTimeout(() => {
                if (exitCode !== null || signalCode !== null) return;
                signalCode = signal;
                exitCode = null;
                emitter.emit("exit", exitCode, signalCode);
            }, delay);
            return true;
        },
        on(event: string, listener: (...args: unknown[]) => void) { emitter.on(event, listener); return processLike; },
        once(event: string, listener: (...args: unknown[]) => void) { emitter.once(event, listener); return processLike; },
    };
    return processLike as unknown as ChildProcessWithoutNullStreams & { signals: NodeJS.Signals[]; stdoutStream: PassThrough };
}

function transport(process: ChildProcessWithoutNullStreams, timeouts?: { terminateGraceMs?: number; exitConfirmMs?: number }): AcpTransport {
    return new AcpTransport("acp", [], {
        cwd: "/",
        handler: () => null,
        spawn: () => process,
        terminateGraceMs: timeouts?.terminateGraceMs ?? 30,
        exitConfirmMs: timeouts?.exitConfirmMs ?? 30,
    });
}

// Admission: sending SIGTERM is not process death; a consumer that treats shutdown resolution as exit can reuse a still-running ACP child.
// Given a child that exits on SIGTERM, shutdown resolves only after the exit event and does not send SIGKILL.
void test("ACP shutdown resolves only after SIGTERM exit is observed", async () => {
    const process = fakeAcpProcess();
    const acp = transport(process);
    let exited = false;
    void acp.waitForClose().then(() => { exited = true; });
    const shuttingDown = acp.shutdown();
    assert.equal(exited, false);
    await shuttingDown;
    assert.equal(exited, true);
    assert.equal(acp.exitObserved(), true);
    assert.deepEqual(process.signals, ["SIGTERM"]);
});

// Admission: a child can ignore SIGTERM; resolving at SIGKILL send would still leave a live process until the later exit.
// Given SIGTERM ignored and a delayed SIGKILL exit, shutdown remains pending until that exit and records both signals.
void test("ACP shutdown waits through SIGKILL delay rather than treating the signal as exit", async () => {
    const process = fakeAcpProcess({ ignoreTerm: true, killExitDelayMs: 40 });
    const acp = transport(process, { terminateGraceMs: 20, exitConfirmMs: 200 });
    const shuttingDown = acp.shutdown();
    const killDeadline = Date.now() + 100;
    while (!process.signals.includes("SIGKILL")) {
        if (Date.now() >= killDeadline) assert.fail("SIGKILL was not sent before the terminate-grace window elapsed");
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(acp.exitObserved(), false);
    await shuttingDown;
    assert.equal(acp.exitObserved(), true);
    assert.deepEqual(process.signals, ["SIGTERM", "SIGKILL"]);
});

// Admission: SIGKILL still may not reap the process; resolving shutdown would report a confirmed stop that did not happen.
// Given a child that never exits, shutdown rejects and leaves exit unobserved.
void test("ACP shutdown rejects when process exit is not confirmed", async () => {
    const process = fakeAcpProcess({ neverExit: true });
    const acp = transport(process, { terminateGraceMs: 10, exitConfirmMs: 10 });
    await assert.rejects(acp.shutdown(), /exit was not confirmed/u);
    assert.equal(acp.exitObserved(), false);
    assert.deepEqual(process.signals, ["SIGTERM", "SIGKILL"]);
});

// Admission: a protocol decode failure is not OS exit; waitForClose used as death would retire without confirming the process is gone.
void test("ACP protocol failure is distinct from process exit", async () => {
    const process = fakeAcpProcess({ neverExit: true });
    const acp = transport(process);
    process.stdoutStream.write("not-json\n");
    await eventually(() => acp.fatalError() !== undefined);
    assert.match(acp.fatalError()!.message, /Malformed ACP JSON-RPC message/u);
    assert.equal(acp.exitObserved(), false);
    let closed = false;
    void acp.waitForClose().then(() => { closed = true; });
    await yieldToIO();
    assert.equal(closed, false);
});

// Admission: further ACP traffic after a fatal protocol error can still be applied if receive keeps dispatching; types cannot observe that.
// Given a malformed line then a later request, the transport ignores the later message and does not write a response.
void test("ACP receive ignores messages after a fatal protocol error", async () => {
    const process = fakeAcpProcess({ neverExit: true });
    let handled = 0;
    const acp = new AcpTransport("acp", [], {
        cwd: "/",
        handler: () => { handled += 1; return { ok: true }; },
        spawn: () => process,
        terminateGraceMs: 30,
        exitConfirmMs: 30,
    });
    const written: string[] = [];
    process.stdin.on("data", chunk => { written.push(String(chunk)); });
    process.stdoutStream.write("not-json\n");
    await eventually(() => acp.fatalError() !== undefined);
    process.stdoutStream.write(`${JSON.stringify({ jsonrpc: "2.0", id: "late-1", method: "session/update", params: {} })}\n`);
    await yieldToIO();
    await yieldToIO();
    assert.equal(handled, 0);
    assert.equal(written.some(chunk => chunk.includes("late-1")), false);
});

// Admission: a stdin write or stream error can escape as an unhandled exception and abort the worker; types cannot observe containment.
// Given a destroyed stdin, request and notify fail into the protocol error instead of throwing to the caller.
void test("ACP contains stdin write and stream errors as protocol failures", async () => {
    const process = fakeAcpProcess({ neverExit: true });
    const acp = transport(process);
    process.stdin.destroy(new Error("broken pipe"));
    await eventually(() => acp.fatalError() !== undefined);
    assert.match(acp.fatalError()!.message, /stdin/u);
    await assert.rejects(acp.request("session/prompt", {}), /stdin|ACP/u);
    acp.notify("session/cancel", {});
    assert.equal(acp.exitObserved(), false);
});
