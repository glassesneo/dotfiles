import assert from "node:assert/strict";
import test from "node:test";
import { filterPaletteItems } from "../extensions_src/utilities/command_palette_core.ts";

void test("palette filtering searches labels, descriptions, keywords, and state", () => {
    const items = [{ value: "model", label: "Select model", description: "Choose provider", keywords: ["llm"], state: "Current: x" }, { value: "theme", label: "Theme" }];
    assert.deepEqual(filterPaletteItems(items, "provider current").map(item => item.value), ["model"]);
    assert.deepEqual(filterPaletteItems(items, "LLM").map(item => item.value), ["model"]);
});

