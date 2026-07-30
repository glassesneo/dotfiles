import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

void test("Nix wiring resolves command palette after profile through default extension aggregation", async () => {
    const base = await readFile(new URL("../default.nix", import.meta.url), "utf8");
    assert.match(base, /defaultExtensions = readOnly[\s\S]*"profile"\s*"command_palette"\s*"subagent"/u);
    assert.match(base, /settings = \{\s*extensions = lib\.mkBefore extensionPaths;/u);
    const module = await readFile(new URL("../extensions/command_palette/default.nix", import.meta.url), "utf8");
    assert.match(module, /parent\.enable && builtins\.elem "command_palette" parent\.defaultExtensions/u);
    assert.match(module, /extensionPaths = readOnly/u);
    assert.doesNotMatch(module, /settings\.extensions/u);
});

void test("Nix wiring resolves subagent as a default extension with childExcludedTools", async () => {
    const module = await readFile(new URL("../extensions/subagent/default.nix", import.meta.url), "utf8");
    assert.match(module, /parent\.enable && builtins\.elem "subagent" parent\.defaultExtensions/u);
    assert.match(module, /extensionPaths = readOnly/u);
    assert.match(module, /childExcludedTools = listOfOption str \[\]/u);
    assert.match(module, /natureHandleWords = listOfOption str \[/u);
    assert.match(module, /schemaVersion = 6/u);
    assert.match(module, /inherit \(cfg\) natureHandleWords/u);
    assert.match(module, /allowAllTools targets are forbidden/u);
    assert.doesNotMatch(module, /settings\.extensions/u);
    const question = await readFile(new URL("../extensions/question/default.nix", import.meta.url), "utf8");
    assert.match(question, /subagent\.childExcludedTools = \["question"\]/u);
});
