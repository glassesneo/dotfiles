import assert from "node:assert/strict";
import test from "node:test";
import { extractLastAssistantText, filterPaletteItems } from "../extensions_src/utilities/command_palette_core.ts";

void test("palette filtering searches labels, descriptions, keywords, and state", () => {
    const items = [{ value: "model", label: "Select model", description: "Choose provider", keywords: ["llm"], state: "Current: x" }, { value: "theme", label: "Theme" }];
    assert.deepEqual(filterPaletteItems(items, "provider current").map(item => item.value), ["model"]);
    assert.deepEqual(filterPaletteItems(items, "LLM").map(item => item.value), ["model"]);
});

void test("last response extraction uses only the active entries passed and only text blocks", () => {
    const entries = [
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "old" }] } },
        { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "secret" }] } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "new" }, { type: "toolCall", name: "x" }, { type: "text", text: "tail" }] } },
    ];
    assert.equal(extractLastAssistantText(entries), "new\ntail");
    assert.equal(extractLastAssistantText([{ type: "message", message: { role: "assistant", content: [{ type: "thinking" }] } }]), undefined);
});
