import { describe, expect, test } from "bun:test";
import { TextareaRenderable } from "@opentui/core";
import { testRender, type JSX } from "@opentui/solid";
import { setupDefaultUI } from "../contributions/default";
import type { StageContentType, ItemType } from "./controllers";
import { createHarnessUI, type HarnessUIActions } from "./harness-ui";
import { ScreenLayout } from "./screen";
import { count, fixture, RESIZE_SEQUENCE } from "./test-support";

const stubStage: StageContentType<string, JSX.Element> = {
  kind: "stub",
  defaultValue: "",
  render: ({ value }) => <text>{`stage:${value}`}</text>,
};

const noteType: ItemType<{ text: string }, JSX.Element> = {
  kind: "note",
  render: ({ value }) => <text>{value.text}</text>,
  sourceText: (value) => value.text,
  actions: {},
};

function createHarness() {
  const ui = createHarnessUI<JSX.Element>({});
  const calls = {
    submit: 0,
    cancel: 0,
    quit: 0,
    timelineMoveCursor: 0,
    timelineScroll: 0,
    timelineCopy: 0,
    stageMoveCursor: 0,
    stageConfirm: 0,
    stageCancel: 0,
  };
  const actions: HarnessUIActions = {
    submit: () => (calls.submit += 1),
    cancel: () => (calls.cancel += 1),
    quit: () => (calls.quit += 1),
    focusFromEditor: (target) => ui.controllers.editor.requestFocus(target),
    moveTimelineCursor: () => (calls.timelineMoveCursor += 1),
    scrollTimeline: () => (calls.timelineScroll += 1),
    copyTimelineItem: () => (calls.timelineCopy += 1),
    moveStageCursor: () => (calls.stageMoveCursor += 1),
    confirmStage: () => (calls.stageConfirm += 1),
    cancelStage: () => (calls.stageCancel += 1),
  };
  const registrations = setupDefaultUI(ui, actions);
  return { ui, actions, calls, registrations };
}

describe("ScreenLayout layout", () => {
  test("keeps timeline full-size and clamps overlays through the resize sequence", async () => {
    const harness = createHarness();
    const setup = await testRender(
      () => <ScreenLayout ui={harness.ui} timeline={<text>timeline</text>} stage={() => <text>stage</text>} />,
      { width: 120, height: 40 },
    );
    harness.ui.controllers.stage.show({
      requester: "test",
      type: stubStage,
      value: "x",
      preferredHeight: 4,
    });
    await setup.flush();

    for (const [width, height] of [...RESIZE_SEQUENCE, ...[...RESIZE_SEQUENCE].reverse()]) {
      setup.resize(width, height);
      await setup.renderOnce();
      await setup.flush();

      // Timeline keeps the whole terminal; overlays do not shrink its dimensions.
      const timeline = setup.renderer.root.findDescendantById("harness-timeline");
      expect(timeline!.width).toBe(width);
      expect(timeline!.height).toBe(height);

      const editorBox = setup.renderer.root.findDescendantById("harness-editor");
      expect(editorBox!.y).toBeGreaterThanOrEqual(0);
      expect(editorBox!.y + editorBox!.height).toBe(height);

      const stage = setup.renderer.root.findDescendantById("harness-stage");
      if (stage) {
        expect(stage.y).toBeGreaterThanOrEqual(0);
        expect(stage.y + stage.height).toBeLessThanOrEqual(height);
        expect(stage.y + stage.height).toBeLessThanOrEqual(editorBox!.y);
      }

      expect(count(setup.renderer.root, (renderable) => renderable.focused)).toBe(1);
      expect(
        count(setup.renderer.root, (renderable) => renderable instanceof TextareaRenderable),
      ).toBe(1);

      // The editor has no side border, so its body spans the full width at
      // every height, including the chrome-less two-row terminal.
      const textarea = setup.renderer.root.findDescendantById("harness-textarea");
      expect(textarea!.width).toBe(width);
      expect(textarea!.height).toBeGreaterThanOrEqual(Math.min(2, height));
      expect(textarea!.height).toBeLessThanOrEqual(8);
    }

    setup.renderer.destroy();
  });

  test("prefers 2 body rows for short text and 8 with internal scroll for long text", async () => {
    const harness = createHarness();
    const setup = await testRender(() => <ScreenLayout ui={harness.ui} timeline={<text>timeline</text>} />, {
      width: 120,
      height: 40,
    });
    await setup.flush();

    const { editor } = harness.ui.controllers;
    expect(editor.snapshot().preferredHeight).toBe(2);

    editor.setText("word ".repeat(200));
    await setup.flush();
    expect(editor.snapshot().preferredHeight).toBe(8);
    const textarea = setup.renderer.root.findDescendantById("harness-textarea") as TextareaRenderable;
    expect(textarea.height).toBe(8);
    // Content taller than the viewport stays inside the textarea.
    expect(textarea.editorView.getTotalVirtualLineCount()).toBeGreaterThan(8);

    // Shrinking the text returns the body to its two-row minimum.
    editor.setText("short");
    await setup.flush();
    expect(editor.snapshot().preferredHeight).toBe(2);
    expect(textarea.height).toBe(2);

    setup.renderer.destroy();
  });

  test("follows native deletes one row at a time after the eight-row clamp", async () => {
    const harness = createHarness();
    const setup = await testRender(() => <ScreenLayout ui={harness.ui} timeline={<text>timeline</text>} />, {
      width: 80,
      height: 24,
    });
    await setup.flush();

    const textarea = setup.renderer.root.findDescendantById("harness-textarea") as TextareaRenderable;
    const { editor } = harness.ui.controllers;
    // Ten lines arrive through the native paste path, so the shrink below is
    // measured on native edits rather than a replacement `editor.setText`.
    await setup.mockInput.pasteBracketedText(
      Array.from({ length: 10 }, (_, index) => `line${index}`).join("\n"),
    );
    await setup.flush();
    expect(editor.snapshot().preferredHeight).toBe(8);

    textarea.cursorOffset = textarea.plainText.length;
    await setup.flush();

    const preferred: number[] = [];
    const allocated: number[] = [];
    const scrollOffsets: number[] = [];
    for (let line = 0; line < 9; line++) {
      const lastBreak = textarea.plainText.lastIndexOf("\n");
      const remaining =
        lastBreak < 0 ? textarea.plainText.length : textarea.plainText.length - lastBreak;
      for (let key = 0; key < remaining; key++) setup.mockInput.pressBackspace();
      await setup.flush();
      preferred.push(editor.snapshot().preferredHeight);
      allocated.push(textarea.height);
      scrollOffsets.push(textarea.editorView.getViewport().offsetY);
      expect(textarea.height).toBe(editor.snapshot().preferredHeight);
    }

    // Clamped at eight while ten-to-eight lines remain, then one row per delete.
    expect(preferred).toEqual([8, 8, 7, 6, 5, 4, 3, 2, 2]);
    expect(allocated).toEqual([8, 8, 7, 6, 5, 4, 3, 2, 2]);
    // Deleting the ninth and eighth lines also clamps the editor's internal
    // viewport, instead of leaving an unreachable blank row below line eight.
    expect(scrollOffsets).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);

    setup.renderer.destroy();
  });

  test("keeps the editor transparent while clipping scrolled timeline beneath it", async () => {
    const harness = createHarness();
    const lines = Array.from({ length: 30 }, (_, index) => `UNDER-${index}`);
    const setup = await testRender(
      () => (
        <ScreenLayout
          ui={harness.ui}
          timeline={
            <scrollbox height="100%" stickyScroll stickyStart="bottom">
              {lines.map((line) => <text>{line}</text>)}
            </scrollbox>
          }
        />
      ),
      { width: 40, height: 24 },
    );
    await setup.flush();

    const editorBox = setup.renderer.root.findDescendantById("harness-editor") as unknown as {
      backgroundColor: { a: number };
    };
    const textarea = setup.renderer.root.findDescendantById("harness-textarea") as TextareaRenderable;
    expect(editorBox.backgroundColor.a).toBe(0);
    expect((textarea.backgroundColor as unknown as { a: number }).a).toBe(0);

    const frame = setup.captureCharFrame().split("\n");
    const editorRow = frame.findIndex((line) => line.includes("prompt [editor]"));
    expect(editorRow).toBeGreaterThan(0);
    // The timeline keeps its full layout, but its paint is clipped at the editor.
    const timeline = setup.renderer.root.findDescendantById("harness-timeline");
    const clip = setup.renderer.root.findDescendantById("harness-timeline-clip");
    expect(timeline!.height).toBe(24);
    expect(clip!.height).toBe(editorRow);
    expect(frame.slice(editorRow, editorRow + 4).join("\n")).not.toMatch(/UNDER-\d/);

    setup.renderer.destroy();
  });

  test("draws only full-width top and bottom editor rules with no side border", async () => {
    const harness = createHarness();
    const setup = await testRender(() => <ScreenLayout ui={harness.ui} timeline={<text>timeline</text>} />, {
      width: 40,
      height: 24,
    });
    await setup.flush();

    const frame = setup.captureCharFrame().split("\n");
    const editorRow = frame.findIndex((line) => line.includes("prompt [editor]"));
    expect(editorRow).toBeGreaterThan(0);
    const editorRows = frame.slice(editorRow, editorRow + 4);
    expect(editorRows[0]!.startsWith("─")).toBe(true);
    expect(editorRows[0]!.endsWith("─")).toBe(true);
    expect(editorRows[3]).toBe("─".repeat(40));
    for (const row of editorRows) expect(row).not.toContain("│");

    const textarea = setup.renderer.root.findDescendantById("harness-textarea") as TextareaRenderable;
    expect(textarea.width).toBe(40);

    setup.renderer.destroy();
  });
});

describe("ScreenLayout overlays", () => {
  test("draws editor assist only while no blocking stage request is active", async () => {
    const harness = createHarness();
    const setup = await testRender(
      () => <ScreenLayout ui={harness.ui} timeline={<text>timeline</text>} stage={() => <text>blocking</text>} />,
      { width: 80, height: 24 },
    );
    await setup.flush();

    const { stage, editor } = harness.ui.controllers;
    editor.setAssist({ items: ["assist-item"], cursor: 0 });
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("harness-stage")).toBeDefined();
    expect(setup.captureCharFrame()).toContain("assist-item");

    const handle = stage.show({
      requester: "test",
      type: stubStage,
      value: "x",
      preferredHeight: 3,
    });
    await setup.flush();
    const blocked = setup.captureCharFrame();
    expect(blocked).toContain("blocking");
    expect(blocked).not.toContain("assist-item");

    handle.cancel();
    await handle.closed;
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("assist-item");

    setup.renderer.destroy();
  });

  test("focuses stage for a nonempty assist and falls back when the stage has no rows", async () => {
    const tall = createHarness();
    const tallSetup = await testRender(
      () => <ScreenLayout ui={tall.ui} timeline={<text>timeline</text>} />,
      { width: 80, height: 24 },
    );
    await tallSetup.flush();
    const tallRegions = tall.ui.controllers.regions;
    expect(tallRegions.requestFocus("stage")).toBe(false);
    tall.ui.controllers.editor.setAssist({ items: ["a"], cursor: 0 });
    await tallSetup.flush();
    expect(tallRegions.requestFocus("stage")).toBe(true);
    await tallSetup.flush();
    expect(tallRegions.current()).toBe("stage");
    tallSetup.renderer.destroy();

    const short = createHarness();
    const shortSetup = await testRender(
      () => <ScreenLayout ui={short.ui} timeline={<text>timeline</text>} stage={() => <text>stage</text>} />,
      { width: 40, height: 2 },
    );
    await shortSetup.flush();
    short.ui.controllers.editor.setAssist({ items: ["a"], cursor: 0 });
    await shortSetup.flush();
    const shortRegions = short.ui.controllers.regions;
    // Available through the assist, but a zero-row stage must not hold focus.
    expect(shortRegions.requestFocus("stage")).toBe(true);
    await shortSetup.flush();
    expect(shortRegions.current()).toBe("editor");
    expect(shortSetup.renderer.root.findDescendantById("harness-stage")).toBeUndefined();
    shortSetup.renderer.destroy();
  });
});

describe("ScreenLayout with the editor controller", () => {
  test("continues editing at the caret after positional paste and controller insertion", async () => {
    const f = fixture();
    const setup = await testRender(() => <ScreenLayout ui={f.ui} timeline={<text>timeline</text>} />, { width: 80, height: 24 });
    try {
      await setup.flush();
      const textarea = setup.renderer.root.findDescendantById("harness-textarea") as TextareaRenderable;
      const editor = f.ui.controllers.editor;
      f.extension.context.setEditorText("abcd");
      await setup.flush();
      textarea.cursorOffset = 2;
      await setup.flush();
      f.extension.context.pasteToEditor("!");
      await setup.flush();
      expect(textarea.plainText).toBe("ab!cd");
      expect(textarea.cursorOffset).toBe(3);
      expect(editor.snapshot().cursor).toBe(3);
      await setup.mockInput.typeText("X");
      await setup.flush();
      expect(textarea.plainText).toBe("ab!Xcd");
      expect(editor.snapshot().text).toBe("ab!Xcd");
      expect(editor.snapshot().cursor).toBe(4);
      editor.setText("ab!X?cd");
      editor.setCursor(5);
      await setup.flush();
      await setup.mockInput.typeText("Y");
      await setup.flush();
      expect(textarea.plainText).toBe("ab!X?Ycd");
      expect(editor.snapshot().text).toBe("ab!X?Ycd");
      expect(editor.snapshot().cursor).toBe(6);
      const draft = editor.openDraft({ destination: "caret", label: "Caret", requester: "editor", initialText: "a longer borrowed draft" });
      await setup.flush();
      editor.cancelDraft(); await draft; await setup.flush();
      expect(editor.snapshot().cursor).toBe(textarea.cursorOffset);
      await setup.mockInput.typeText("Z"); await setup.flush();
      expect(editor.snapshot().text).toBe("ab!X?YcdZ");
    } finally {
      setup.renderer.destroy();
      f.dispose();
    }
  });
  test("retains a draft, assist, and timeline cursor across resizes", async () => {
    const harness = createHarness();
    const setup = await testRender(() => <ScreenLayout ui={harness.ui} timeline={<text>timeline</text>} />, {
      width: 120,
      height: 40,
    });
    await setup.flush();

    const { editor, timeline } = harness.ui.controllers;
    const factory = timeline.registerType(noteType);
    const first = factory.create({ text: "first" });
    const second = factory.create({ text: "second" });
    timeline.append(first);
    timeline.append(second);
    timeline.setCursor(second.id);

    const draft = editor.openDraft({ destination: "note", label: "Note", requester: "editor" });
    editor.setText("kept draft");
    editor.setAssist({ items: ["x"], cursor: 0 });
    await setup.flush();

    for (const [width, height] of [...RESIZE_SEQUENCE, ...[...RESIZE_SEQUENCE].reverse()]) {
      setup.resize(width, height);
      await setup.renderOnce();
      await setup.flush();
    }

    expect(editor.text()).toBe("kept draft");
    expect(editor.snapshot().assist).toEqual({ items: ["x"], cursor: 0 });
    expect(timeline.cursor()).toBe(second.id);

    editor.cancelDraft();
    await expect(draft).resolves.toEqual({ status: "cancelled" });
    setup.renderer.destroy();
  });

  test("runs a registered key once, suppresses the native key, and honors a declining predicate", async () => {
    const harness = createHarness();
    const setup = await testRender(() => <ScreenLayout ui={harness.ui} timeline={<text>timeline</text>} />, {
      width: 80,
      height: 24,
    });
    await setup.flush();

    const { editor } = harness.ui.controllers;
    expect(harness.ui.controllers.regions.current()).toBe("editor");

    // Enter is registered, so the textarea's default newline must not also run.
    editor.setText("hello");
    await setup.flush();
    setup.mockInput.pressEnter();
    await setup.flush();
    expect(harness.calls.submit).toBe(1);
    expect(editor.text()).toBe("hello");

    // A declining binding falls through to the native textarea; an active one
    // suppresses it. Both run their own action at most once.
    editor.setText("ab");
    await setup.flush();
    let declined = 0;
    let accepted = 0;
    harness.ui.keys.register("test", "editor", [
      { actionId: "editor.declined-test", name: "x", when: () => false, action: () => (declined += 1) },
      { actionId: "editor.accepted-test", name: "z", action: () => (accepted += 1) },
    ]);

    await setup.mockInput.pressKeys(["x"], 30);
    await setup.flush();
    expect(declined).toBe(0);
    expect(editor.text()).toBe("abx");

    await setup.mockInput.pressKeys(["z"], 30);
    await setup.flush();
    expect(accepted).toBe(1);
    expect(editor.text()).toBe("abx");

    setup.renderer.destroy();
  });

  test("retains a destination draft across a draft and restores focus", async () => {
    const harness = createHarness();
    const setup = await testRender(() => <ScreenLayout ui={harness.ui} timeline={<text>timeline</text>} />, {
      width: 80,
      height: 24,
    });
    await setup.flush();

    const { regions, editor } = harness.ui.controllers;
    expect(regions.requestFocus("timeline")).toBe(true);

    const first = editor.openDraft({ destination: "note", label: "Note", requester: "timeline" });
    await setup.flush();
    expect(regions.current()).toBe("editor");

    editor.setText("remember this");
    await setup.flush();
    expect(editor.snapshot().label).toBe("Note");

    editor.cancelDraft();
    await expect(first).resolves.toEqual({ status: "cancelled" });
    await Promise.resolve();
    expect(regions.current()).toBe("timeline");

    const second = editor.openDraft({ destination: "note", label: "Note", requester: "timeline" });
    await setup.flush();
    expect(editor.text()).toBe("remember this");
    editor.cancelDraft();
    await expect(second).resolves.toEqual({ status: "cancelled" });

    setup.renderer.destroy();
  });
});
