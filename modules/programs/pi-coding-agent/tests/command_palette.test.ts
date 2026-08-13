import assert from "node:assert/strict";
import test from "node:test";
import { buildCommandPaletteActions, executePaletteAction } from "../extensions_src/command_palette.ts";
void test("command palette does not expose mode-owned mutation", () => {
    const actions = buildCommandPaletteActions({} as never, { ui: { getToolsExpanded: () => false, theme: { name: "dark" } } } as never);
    assert.equal(actions.some(action => /model|thinking|tools?/u.test(action.id) && action.id !== "tool-output"), false);
});

void test("immediate tool-output action updates state without closing", async () => {
    let expanded = false;
    const result = await executePaletteAction("tool-output", { getActiveTools: () => [], getThinkingLevel: () => "off" } as never, { ui: { getToolsExpanded: () => expanded, setToolsExpanded: (value: boolean) => { expanded = value; } } } as never, {} as never, { setStatus() {} } as never);
    assert.equal(result, "return");
    assert.equal(expanded, true);
});
