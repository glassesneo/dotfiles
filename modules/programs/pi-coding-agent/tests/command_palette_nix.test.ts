import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

void test("Nix wiring resolves command palette after profile through default extension aggregation", async () => {
    const base = await readFile(new URL("../default.nix", import.meta.url), "utf8");
    assert.match(base, /defaultExtensions = readOnly[\s\S]*"profile"\s*"command_palette"/u);
    assert.match(base, /settings = \{\s*extensions = lib\.mkBefore extensionPaths;/u);
    const module = await readFile(new URL("../extensions/command_palette/default.nix", import.meta.url), "utf8");
    assert.match(module, /parent\.enable && builtins\.elem "command_palette" parent\.defaultExtensions/u);
    assert.match(module, /extensionPaths = readOnly/u);
    assert.doesNotMatch(module, /settings\.extensions/u);
});
