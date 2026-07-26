import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HarnessRunError, PiEventNormalizer, runPiHarness } from "../extensions_src/utilities/subagent_pi.ts";

test("Pi event normalizer converts streaming, tool, final output, and usage", () => {
    const normalizer = new PiEventNormalizer();
    assert.deepEqual(normalizer.consume(JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello" },
    })), [{ type: "assistant_text", data: { text: "hello" } }]);
    assert.deepEqual(normalizer.consume(JSON.stringify({
        type: "tool_execution_start",
        toolName: "read",
        args: { path: "README.md" },
    })), [{ type: "tool_started", data: { tool: "read", arguments: { path: "README.md" } } }]);
    assert.deepEqual(normalizer.consume(JSON.stringify({
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
    })), [{ type: "tool_finished", data: { tool: "read", isError: false } }]);

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
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
        costUsd: 0.01,
        turns: 1,
    });
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

async function invokeFake(command: string) {
    return runPiHarness(
        { schemaVersion: 1, runId: "run", profile: "test", harness: "pi", model: "fake/model", command },
        { prompt: "secret", cwd: tmpdir() },
        { onEvent() {}, onStderr() {} },
    );
}

test("Pi harness classifies malformed JSON and nonzero exits", async () => {
    const malformed = await fakePi("printf 'not-json\\n'");
    await assert.rejects(invokeFake(malformed), (error: unknown) => {
        assert.ok(error instanceof HarnessRunError);
        assert.equal(error.category, "protocol");
        return true;
    });

    const failed = await fakePi("exit 7");
    await assert.rejects(invokeFake(failed), (error: unknown) => {
        assert.ok(error instanceof HarnessRunError);
        assert.equal(error.category, "harness");
        assert.equal(error.exitCode, 7);
        return true;
    });
});
