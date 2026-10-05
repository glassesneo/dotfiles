import { expect, test } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { InputRenderable, TextareaRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { SessionBindings, SessionHost } from "../core/session";
import { notice } from "../core/session-entries";
import { StageView } from "./stage";
import { Screen, ScreenLayout } from "./screen";
import { count, fixture, tick } from "./test-support";

async function renderFixture(f: ReturnType<typeof fixture>) {
  return testRender(() => <ScreenLayout ui={f.ui} timeline={<text>timeline</text>} stage={() => <StageView ui={f.ui} />} />, { width: 80, height: 24 });
}

test("serializes extension select, editor and confirm, restoring drafts and focus", async () => {
  const f = fixture();
  const { editor, regions, stage } = f.ui.controllers;
  regions.requestFocus("timeline"); editor.setText("prompt draft");
  const cursor = f.extension.context.select("Pick", ["first", "second"]);
  const edited = f.extension.context.editor("Notes", "prefill\nsecond line");
  const confirmed = f.extension.context.confirm("Confirm", "Continue?");
  await tick();
  expect(stage.active()?.kind).toBe("choice");
  await stage.active()?.runAction("next"); await stage.active()?.runAction("confirm");
  expect(await cursor).toBe("second"); await tick();
  expect(editor.activeDraft()).toBe(true); expect(editor.text()).toBe("prefill\nsecond line");
  expect(regions.current()).toBe("editor"); editor.setText("edited\nnotes"); editor.submitDraft();
  expect(await edited).toBe("edited\nnotes"); await tick();
  expect(stage.active()?.kind).toBe("confirm"); await stage.active()?.runAction("confirm");
  expect(await confirmed).toBe(true); expect(editor.text()).toBe("prompt draft"); expect(regions.current()).toBe("timeline");
  f.dispose();
});

test("completes queued and active extension abort, timeout and disposal with defaults", async () => {
  const f = fixture();
  const first = f.extension.context.select("First", ["x"]);
  const abort = new AbortController();
  const queued = f.extension.context.input("Cancelled", undefined, { signal: abort.signal });
  abort.abort(); expect(await queued).toBeUndefined();
  await tick(); f.ui.controllers.stage.active()?.runAction("cancel"); expect(await first).toBeUndefined();
  const timeout = f.extension.context.input("Timed", undefined, { timeout: 5 });
  expect(await timeout).toBeUndefined(); expect(f.ui.controllers.editor.activeDraft()).toBe(false);
  const activeAbort = new AbortController();
  const active = f.extension.context.confirm("Active", "?", { signal: activeAbort.signal }); await tick();
  activeAbort.abort(); expect(await active).toBe(false);
  const editor = f.extension.context.editor("Dispose"); await tick(); f.extension.dispose(); expect(await editor).toBeUndefined();
  expect(f.ui.controllers.stage.hasActive()).toBe(false); f.stage.dispose();
});

test("uses one multiline textarea for extension input and editor", async () => {
  const f = fixture(); const setup = await renderFixture(f); await setup.flush();
  f.extension.context.setEditorText("draft"); f.ui.controllers.editor.setCursor(2); f.extension.context.pasteToEditor("!");
  expect(f.extension.context.getEditorText()).toBe("dr!aft");
  const input = f.extension.context.input("Input", "hint"); await tick(); await setup.flush();
  expect(count(setup.renderer.root, (node) => node instanceof TextareaRenderable && !(node instanceof InputRenderable))).toBe(1);
  f.extension.context.setEditorText("response\nmore"); f.ui.controllers.editor.submitDraft();
  expect(await input).toBe("response\nmore"); expect(f.extension.context.getEditorText()).toBe("dr!aft");
  f.dispose(); setup.renderer.destroy();
});

test("Screen preserves acceptance, streaming follow-up, abort, queue, history replacement and quit", async () => {
  let bindings: SessionBindings | undefined;
  let accepted = false; let streaming = true; let aborts = 0; let disposals = 0;
  const sends: Array<{ text: string; behavior: string }> = [];
  const session = {
    get isStreaming() { return streaming; }, extensionRunner: undefined,
    prompt: (text: string, options: { streamingBehavior: string; preflightResult(): void }) => {
      sends.push({ text, behavior: options.streamingBehavior });
      if (!accepted) return Promise.reject(new Error("rejected"));
      options.preflightResult(); return new Promise<void>(() => {});
    },
    abort: async () => { aborts++; }, messages: [], getSteeringMessages: () => [], getFollowUpMessages: () => [],
  };
  const host = { runtime: { session }, bind: async (value: SessionBindings) => { bindings = value; }, dispose: async () => { disposals++; } } as unknown as SessionHost;
  const setup = await testRender(() => <Screen host={host} startupNotices={[notice("info", "startup-marker")]} />, { width: 80, height: 24 });
  await setup.flush(); expect(setup.captureCharFrame()).toContain("startup-marker");
  await setup.mockInput.typeText("request"); setup.mockInput.pressEnter(); await setup.flush();
  expect(bindings!.uiContext.getEditorText()).toBe("request"); accepted = true;
  setup.mockInput.pressEnter(); await setup.flush(); expect(bindings!.uiContext.getEditorText()).toBe("");
  expect(sends).toEqual([{ text: "request", behavior: "followUp" }, { text: "request", behavior: "followUp" }]);
  setup.mockInput.pressEscape(); await Bun.sleep(100); await setup.flush(); expect(aborts).toBe(1); streaming = false;
  bindings!.onEvent({ type: "queue_update", steering: ["queued-marker"], followUp: [] } as Parameters<SessionBindings["onEvent"]>[0]); await setup.flush();
  expect(setup.captureCharFrame()).toContain("queued-marker");
  bindings!.onHistoryReplaced({ ...session, messages: [{ role: "user", content: "replacement-marker" }] } as unknown as AgentSession); await setup.flush();
  expect(setup.captureCharFrame()).toContain("replacement-marker"); expect(setup.captureCharFrame()).not.toContain("startup-marker");
  for (const text of ["cached-before", "cached-after\n```ts\nlet v = 1\n```\n"]) {
    bindings!.onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text }] } } as Parameters<SessionBindings["onEvent"]>[0]);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain(text.split("\n")[0]);
  }
  expect(setup.captureCharFrame()).not.toContain("cached-before");
  expect(setup.captureCharFrame()).toContain("let v = 1");
  setup.mockInput.pressCtrlC(); await Bun.sleep(100); expect(disposals).toBe(1);
});
