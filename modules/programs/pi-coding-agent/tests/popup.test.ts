import assert from "node:assert/strict";
import test from "node:test";
import { PopupStack } from "../extensions_src/popup.ts";
import type { PopupViewFactory } from "../extensions_src/utilities/popup_types.ts";
void test("popup host owns back focus and disposes a nested close-all exactly once", async () => {
    let renders = 0; const finishes: string[] = []; const seen: string[][] = []; const disposed: string[] = []; const focus: string[] = [];
    const tui = { requestRender: () => { renders += 1; }, terminal: { rows: 30, columns: 100 } } as never;
    const factory = (id: string): PopupViewFactory => ({ id, title: id, create(ctx) { seen.push([...ctx.breadcrumb]); let focused = false; return { get focused() { return focused; }, set focused(value: boolean) { focused = value; focus.push(`${id}:${value}`); }, render: () => [id], invalidate() {}, dispose() { disposed.push(id); }, handleInput(data: string) { if (data === "back") ctx.done("back"); if (data === "close") ctx.done("close-all"); } }; } });
    const factories = new Map([["root", factory("root")], ["child", factory("child")]]);
    const stack = new PopupStack(tui, {} as never, {} as never, factories, value => finishes.push(value)); stack.focused = true;
    const root = stack.open("root"); const child = stack.open("child"); assert.deepEqual(stack.render(80), ["child"]); assert.deepEqual(focus.slice(-2), ["root:false", "child:true"]); stack.handleInput("\x1b"); assert.equal(await child, "back"); assert.deepEqual(disposed, ["child"]); assert.deepEqual(focus.slice(-2), ["child:false", "root:true"]);
    const nested = stack.open("child"); stack.handleInput("close"); stack.handleInput("close"); assert.equal(await nested, "close-all"); assert.equal(await root, "close-all"); assert.deepEqual(finishes, ["close-all"]); assert.deepEqual(disposed, ["child", "child", "root"]); assert.deepEqual(seen, [["root"], ["root", "child"], ["root", "child"]]); assert.ok(renders > 0);
});
void test("the shared agent-sessions factory supports direct root, nested push/back with parent state, and live close-all", async () => {
    const tui = { requestRender() {}, terminal: { rows: 24, columns: 80 } } as never; let creates = 0; let rootSelection = "review"; const finishes: string[] = [];
    const command: PopupViewFactory = { id: "command-palette", title: "Command Palette", create(ctx) { return { render: () => [`selected:${rootSelection}`], invalidate() {}, handleInput(data: string) { if (data === "back") ctx.done("back"); } }; } };
    const sessions: PopupViewFactory = { id: "agent-sessions", title: "Agent Sessions", create(ctx) { creates += 1; return { render: () => ["agent state: RUNNING"], invalidate() {}, handleInput(data: string) { if (data === "back") ctx.done("back"); if (data === "live") ctx.done("close-all"); } }; } };
    const factories = new Map([[command.id, command], [sessions.id, sessions]]); const direct = new PopupStack(tui, {} as never, {} as never, factories, value => finishes.push(`direct:${value}`)); const directResult = direct.open("agent-sessions"); direct.handleInput("\x1b"); assert.equal(await directResult, "back");
    const nested = new PopupStack(tui, {} as never, {} as never, factories, value => finishes.push(`nested:${value}`)); const root = nested.open("command-palette"); rootSelection = "agents"; const child = nested.open("agent-sessions"); nested.handleInput("\x1b"); assert.equal(await child, "back"); assert.deepEqual(nested.render(80), ["selected:agents"]); const live = nested.open("agent-sessions"); nested.handleInput("live"); assert.equal(await live, "close-all"); assert.equal(await root, "close-all"); assert.equal(creates, 3); assert.deepEqual(finishes, ["direct:back", "nested:close-all"]);
});
void test("a disposed child's stale completion cannot settle its parent", async () => {
    let staleChildDone!: (value?: "back" | "close-all") => void; let rootSettled = false; const factory = (id: string): PopupViewFactory => ({ id, title: id, create(ctx) { if (id === "child") staleChildDone = value => ctx.done(value); return { render: () => [id], invalidate() {} }; } });
    const stack = new PopupStack({ requestRender() {} } as never, {} as never, {} as never, new Map([["root", factory("root")], ["child", factory("child")]]), () => { rootSettled = true; }); const root = stack.open("root"); const child = stack.open("child"); stack.handleInput("\x1b"); assert.equal(await child, "back"); staleChildDone("close-all"); staleChildDone("back"); assert.deepEqual(stack.render(20), ["root"]); assert.equal(rootSettled, false); stack.handleInput("\x1b"); assert.equal(await root, "back");
});
void test("synchronous factory completion settles and disposes once without rendering the view", async () => {
    let renders = 0; let disposals = 0; const finishes: string[] = [];
    const factory: PopupViewFactory = { id: "immediate", title: "Immediate", create(ctx) { ctx.done("back"); ctx.done("close-all"); return { render() { renders += 1; return ["orphaned"]; }, invalidate() {}, dispose() { disposals += 1; } }; } };
    const stack = new PopupStack({ requestRender() {} } as never, {} as never, {} as never, new Map([[factory.id, factory]]), value => finishes.push(value));
    const result = stack.open("immediate"); assert.equal(await result, "back"); assert.deepEqual(stack.render(20), []); assert.equal(renders, 0); assert.equal(disposals, 1); assert.deepEqual(finishes, ["back"]);
});
void test("raw Escape defers host back while the current view is busy", async () => {
    let release!: () => void; let finished = false;
    const factory: PopupViewFactory = { id: "busy", title: "Busy", create(ctx) { let busy = true; release = () => { busy = false; ctx.done("back"); }; return { render: () => [busy ? "working" : "done"], invalidate() {}, requestClose() { return !busy; } }; } };
    const stack = new PopupStack({ requestRender() {} } as never, {} as never, {} as never, new Map([[factory.id, factory]]), () => { finished = true; });
    const result = stack.open("busy"); stack.handleInput("\x1b"); assert.equal(finished, false); assert.deepEqual(stack.render(20), ["working"]); release(); assert.equal(await result, "back"); assert.equal(finished, true);
});
