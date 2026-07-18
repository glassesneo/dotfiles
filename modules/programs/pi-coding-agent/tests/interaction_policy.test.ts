import assert from "node:assert/strict";
import test from "node:test";
import { applyCtrlCPolicy } from "../extensions/interaction_policy.ts";

function scenario(idle: boolean, initial: string) {
    let text = initial; let aborts = 0; let clears = 0;
    applyCtrlCPolicy({ isIdle: () => idle, abort: () => { aborts += 1; } }, {
        getExpandedText: () => text,
        setText(value) { text = value; clears += 1; },
    });
    return { text, aborts, clears };
}

test("Ctrl-C aborts active work before touching editor text", () => {
    assert.deepEqual(scenario(false, "draft"), { text: "draft", aborts: 1, clears: 0 });
});

test("Ctrl-C clears idle non-empty input and is inert for idle empty input", () => {
    assert.deepEqual(scenario(true, "draft"), { text: "", aborts: 0, clears: 1 });
    assert.deepEqual(scenario(true, ""), { text: "", aborts: 0, clears: 0 });
});
