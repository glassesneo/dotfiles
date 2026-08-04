import assert from "node:assert/strict";
import test from "node:test";
import { InteractionPolicyEditor, StopConfirmationController, applyCtrlCPolicy } from "../extensions_src/interaction_policy.ts";

function scenario(idle: boolean, initial: string) {
    let text = initial; let aborts = 0; let clears = 0;
    applyCtrlCPolicy({ isIdle: () => idle, abort: () => { aborts += 1; } }, {
        getExpandedText: () => text,
        setText(value) { text = value; clears += 1; },
    });
    return { text, aborts, clears };
}

function clock() {
    let current = 0;
    let nextTimer = 0;
    const timers = new Map<number, { callback: () => void; at: number }>();
    return {
        now: () => current,
        setTimeout(callback: () => void, delay: number) {
            const id = ++nextTimer;
            timers.set(id, { callback, at: current + delay });
            return id;
        },
        clearTimeout(handle: unknown) { timers.delete(handle as number); },
        advance(delay: number) {
            current += delay;
            for (const [id, timer] of timers) {
                if (timer.at <= current) {
                    timers.delete(id);
                    timer.callback();
                }
            }
        },
        timerCount: () => timers.size,
    };
}

function editorFixture(idle = false) {
    const statuses: (string | undefined)[] = [];
    const timers = clock();
    let forwarded = 0;
    let aborts = 0;
    const context = { isIdle: () => idle, abort: () => { aborts += 1; } };
    const keybindings = {
        matches(data: string, action: string) { return (data === "\x1b" && action === "app.interrupt") || (data === "\x03" && action === "app.clear"); },
        getKeys(action: string) { return action === "app.interrupt" ? ["escape"] : action === "app.clear" ? ["ctrl+c"] : []; },
    };
    const stopConfirmation = new StopConfirmationController(text => { statuses.push(text); }, timers);
    const editor = new InteractionPolicyEditor(
        { requestRender() {}, terminal: { columns: 80, rows: 24 } } as never,
        {} as never,
        keybindings as never,
        context,
        stopConfirmation,
    );
    editor.onEscape = () => { forwarded += 1; };
    return { editor, statuses, timers, forwarded: () => forwarded, aborts: () => aborts };
}

void test("Ctrl-C aborts active work before touching editor text", () => {
    assert.deepEqual(scenario(false, "draft"), { text: "draft", aborts: 1, clears: 0 });
});

void test("Ctrl-C clears idle non-empty input and is inert for idle empty input", () => {
    assert.deepEqual(scenario(true, "draft"), { text: "", aborts: 0, clears: 1 });
    assert.deepEqual(scenario(true, ""), { text: "", aborts: 0, clears: 0 });
});

void test("stop confirmation requires the same non-repeated key before its deadline", () => {
    const timers = clock();
    const statuses: (string | undefined)[] = [];
    let stops = 0;
    const confirmation = new StopConfirmationController(text => { statuses.push(text); }, timers);

    confirmation.handle("escape", false, () => { stops += 1; });
    assert.deepEqual(statuses, ["Press escape again to stop"]);
    assert.equal(timers.timerCount(), 1);
    confirmation.handle("escape", false, () => { stops += 1; });
    assert.equal(stops, 1);
    assert.equal(statuses.at(-1), undefined);
    assert.equal(timers.timerCount(), 0);
});

void test("different keys replace confirmation and ordinary input clears it", () => {
    const timers = clock();
    const statuses: (string | undefined)[] = [];
    const confirmation = new StopConfirmationController(text => { statuses.push(text); }, timers);
    let stops = 0;

    confirmation.handle("escape", false, () => { stops += 1; });
    confirmation.handle("ctrl+c", false, () => { stops += 1; });
    assert.deepEqual(statuses, ["Press escape again to stop", undefined, "Press ctrl+c again to stop"]);
    confirmation.clear();
    assert.equal(stops, 0);
    assert.equal(statuses.at(-1), undefined);
});

void test("expired confirmation starts over and repeated input neither starts nor confirms", () => {
    const timers = clock();
    const statuses: (string | undefined)[] = [];
    const confirmation = new StopConfirmationController(text => { statuses.push(text); }, timers);
    let stops = 0;

    confirmation.handle("escape", true, () => { stops += 1; });
    assert.equal(timers.timerCount(), 0);
    confirmation.handle("escape", false, () => { stops += 1; });
    timers.advance(1499);
    confirmation.handle("escape", true, () => { stops += 1; });
    assert.equal(stops, 0);
    assert.equal(statuses.at(-1), "Press escape again to stop");
    timers.advance(1);
    assert.equal(statuses.at(-1), undefined);
    confirmation.handle("escape", false, () => { stops += 1; });
    assert.equal(stops, 0);
    assert.equal(statuses.at(-1), "Press escape again to stop");
});

void test("configured app.interrupt is guarded and invokes pi's forwarded escape exactly once", () => {
    const fixture = editorFixture();
    fixture.editor.handleInput("\x1b");
    assert.equal(fixture.forwarded(), 0);
    assert.equal(fixture.statuses.at(-1), "Press escape again to stop");

    fixture.editor.handleInput("\x1b");
    assert.equal(fixture.forwarded(), 1);
    assert.equal(fixture.statuses.at(-1), undefined);
});

void test("active Ctrl-C is guarded while idle Ctrl-C keeps the existing policy", () => {
    const fixture = editorFixture();
    fixture.editor.handleInput("\x03");
    assert.equal(fixture.aborts(), 0);
    assert.equal(fixture.statuses.at(-1), "Press ctrl+c again to stop");
    fixture.editor.handleInput("\x03");
    assert.equal(fixture.aborts(), 1);

    const idle = editorFixture(true);
    idle.editor.setText("draft");
    idle.editor.handleInput("\x03");
    assert.equal(idle.editor.getText(), "");
    assert.equal(idle.aborts(), 0);
});

void test("ordinary input cancels pending confirmation and remains editor input", () => {
    const fixture = editorFixture();
    fixture.editor.handleInput("\x1b");
    fixture.editor.handleInput("a");
    assert.equal(fixture.statuses.at(-1), undefined);
    assert.equal(fixture.editor.getText(), "a");
});
