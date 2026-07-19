import assert from "node:assert/strict";
import test from "node:test";
import { extractLastAssistantText, filterPaletteItems, formatContextUsage, summarizeSession } from "../extensions/utilities/command_palette_core.ts";

test("palette filtering searches labels, descriptions, keywords, and state", () => {
    const items = [{ value: "model", label: "Select model", description: "Choose provider", keywords: ["llm"], state: "Current: x" }, { value: "theme", label: "Theme" }];
    assert.deepEqual(filterPaletteItems(items, "provider current").map(item => item.value), ["model"]);
    assert.deepEqual(filterPaletteItems(items, "LLM").map(item => item.value), ["model"]);
});

test("last response extraction uses only the active entries passed and only text blocks", () => {
    const entries = [
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "old" }] } },
        { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "secret" }] } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "new" }, { type: "toolCall", name: "x" }, { type: "text", text: "tail" }] } },
    ];
    assert.equal(extractLastAssistantText(entries), "new\ntail");
    assert.equal(extractLastAssistantText([{ type: "message", message: { role: "assistant", content: [{ type: "thinking" }] } }]), undefined);
});

test("session summary counts messages, calls, results, and context", () => {
    const summary = summarizeSession([
        { type: "message", message: { role: "user", content: "hi" } },
        { type: "message", message: { role: "assistant", content: [{ type: "toolCall" }, { type: "text" }] } },
        { type: "message", message: { role: "toolResult", content: [] } },
        { type: "model_change" },
    ]);
    assert.deepEqual(summary, { entryCount: 4, userCount: 1, assistantCount: 1, toolCallCount: 1, toolResultCount: 1 });
    assert.equal(formatContextUsage({ tokens: 500, contextWindow: 1000, percent: 50 }), "500 / 1,000 tokens (50.0%)");
});
