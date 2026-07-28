import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HarnessRunError, HarnessStoppedError, PiEventNormalizer, runPiHarness } from "../extensions_src/utilities/subagent_pi.ts";

test("Pi event normalizer converts streaming, tool, final output, and usage", () => {
    const normalizer = new PiEventNormalizer();
    assert.deepEqual(normalizer.consume(JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello" },
    })), [{ type: "assistant_text", data: { text: "hello" } }]);
    assert.deepEqual(normalizer.consume(JSON.stringify({
        type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: { path: "README.md" },
    })), [{ type: "tool_started", data: { toolCallId: "call-1", name: "read", arguments: { path: "README.md" } } }]);
    assert.deepEqual(normalizer.consume(JSON.stringify({
        type: "tool_execution_end", toolCallId: "call-1", toolName: "read", isError: false,
        result: { content: [{ type: "text", text: "file body" }] },
    })), [{ type: "tool_finished", data: { toolCallId: "call-1", name: "read", isError: false, result: "file body" } }]);

    normalizer.consume(JSON.stringify({
        type: "message_end",
        message: {
            role: "assistant",
            content: [{ type: "text", text: "final" }],
            stopReason: "end",
            usage: { input: 10, output: 4, cacheRead: 3, cacheWrite: 2, cost: { total: 0.01 } },
        },
    }));
    assert.equal(normalizer.finalOutput, "final");
    assert.deepEqual(normalizer.usage, {
        input: 10,
        output: 4,
        cacheRead: 3,
        cacheWrite: 2,
        totalTokens: 19,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
    });
    assert.equal(normalizer.turns, 1);
});

test("Pi event normalizer aggregates nested tool usage exactly once", () => {
    const normalizer = new PiEventNormalizer();
    const nestedUsage = {
        input: 5, output: 6, cacheRead: 1, cacheWrite: 2, reasoning: 3, cacheWrite1h: 1, totalTokens: 14,
        cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0.02, total: 0.33 },
    };
    normalizer.consume(JSON.stringify({
        type: "tool_execution_end", toolCallId: "nested", toolName: "subagent_get", isError: false,
        result: { usage: nestedUsage },
    }));
    normalizer.consume(JSON.stringify({
        type: "message_end", message: { role: "toolResult", toolCallId: "nested", usage: nestedUsage },
    }));
    assert.equal(normalizer.usage.input, 5);
    assert.equal(normalizer.usage.output, 6);
    assert.equal(normalizer.usage.reasoning, 3);
    assert.equal(normalizer.usage.cacheWrite1h, 1);
    assert.equal(normalizer.usage.cost.total, 0.33);
});

test("Pi event normalizer records malformed protocol input", () => {
    const normalizer = new PiEventNormalizer();
    assert.deepEqual(normalizer.consume("not json"), []);
    assert.equal(normalizer.malformedLine, "not json");
});

async function fakePi(script: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "fake-pi-"));
    const path = join(directory, "pi");
    await writeFile(path, `#!/bin/sh\ncat >/dev/null\n${script}\n`);
    await chmod(path, 0o700);
    return path;
}

async function invokeFake(command: string, signal?: AbortSignal) {
    return runPiHarness(
        {
            schemaVersion: 3, runId: "550e8400-e29b-41d4-a716-446655440000", profile: "test",
            callerProfile: "full", targetProfile: "test", depth: 1, originSessionId: "session",
            profileSnapshot: { model: "fake/model", description: "Fake harness profile.", allowAllTools: false, tools: ["read"], extensions: { subagent: { allowedTargets: [] } } },
            command, extensionPaths: ["/profile.ts", "/subagent.ts"],
        },
        { prompt: "secret", cwd: tmpdir() },
        { onEvent() {}, onStderr() {} },
        signal,
    );
}

test("Pi harness escalates an ignored cooperative stop and preserves partial usage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fake-pi-stop-"));
    const command = join(directory, "pi");
    await writeFile(command, `#!${process.execPath}\nprocess.on("SIGTERM", () => {});\nprocess.stdin.resume();\nprocess.stdin.on("end", () => {\n  process.stdout.write('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"partial"}],"stopReason":"end","usage":{"input":4,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":5,"cost":{"total":0.1}}}}\\n');\n  setInterval(() => {}, 1000);\n});\n`);
    await chmod(command, 0o700);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    await assert.rejects(invokeFake(command, controller.signal), (error: unknown) => {
        assert.ok(error instanceof HarnessStoppedError);
        assert.equal(error.method, "forced");
        assert.equal(error.usage.input, 4);
        assert.equal(error.output, "partial");
        return true;
    });
});

test("Pi harness classifies malformed JSON and nonzero exits while preserving partial usage", async () => {
    const malformed = await fakePi("printf 'not-json\\n'");
    await assert.rejects(invokeFake(malformed), (error: unknown) => {
        assert.ok(error instanceof HarnessRunError);
        assert.equal(error.category, "protocol");
        return true;
    });

    const failed = await fakePi(`printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"failed","usage":{"input":9,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":10,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0.5}}}}'; exit 7`);
    await assert.rejects(invokeFake(failed), (error: unknown) => {
        assert.ok(error instanceof HarnessRunError);
        assert.equal(error.category, "harness");
        assert.equal(error.exitCode, 7);
        assert.equal(error.usage.input, 9);
        assert.equal(error.usage.cost.total, 0.5);
        return true;
    });
});
