import assert from "node:assert/strict";
import test from "node:test";
import { validateExtensionKeybindings } from "../extensions_src/utilities/extension_keybindings.ts";
import { tmuxKeyToken } from "../extensions_src/utilities/subagent_preview.ts";

const valid = {
    schemaVersion: 1,
    features: {
        profile: { cycle: [] },
        historyViewer: { exit: ["ctrl+d"] },
        subagentNavigation: { parent: ["u"] },
    },
};

void test("extension keybinding schema rejects unknown, missing, and empty required actions", () => {
    assert.doesNotThrow(() => validateExtensionKeybindings(valid));
    assert.throws(() => validateExtensionKeybindings({ schemaVersion: 1, features: { typo: {} } }), /unknown feature typo/);
    assert.throws(() => validateExtensionKeybindings({ schemaVersion: 1, features: { historyViewer: {} } }), /missing action.*exit/);
    assert.throws(() => validateExtensionKeybindings({ schemaVersion: 1, features: { historyViewer: { exit: [], typo: [] } } }), /unknown action.*typo/);
    assert.throws(() => validateExtensionKeybindings({ schemaVersion: 1, features: { historyViewer: { exit: [] } } }), /exit is required/);
    assert.throws(() => validateExtensionKeybindings({ schemaVersion: 1, features: { subagentNavigation: { parent: [] } } }), /parent is required/);
});

void test("tmux key translation canonicalizes aliases and rejects unsupported keys", () => {
    assert.equal(tmuxKeyToken("esc"), "Escape");
    assert.equal(tmuxKeyToken("return"), "Enter");
    assert.equal(tmuxKeyToken("ctrl+c"), "C-c");
    assert.equal(tmuxKeyToken("pageUp"), "PPage");
    assert.throws(() => tmuxKeyToken("alt+x"), /Unsupported tmux key modifier/);
    assert.throws(() => tmuxKeyToken("clear"), /Unsupported tmux key/);
    assert.throws(() => tmuxKeyToken(";"), /Unsupported tmux key/);
});
