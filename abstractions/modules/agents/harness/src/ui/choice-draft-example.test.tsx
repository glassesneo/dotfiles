/**
 * Behavioral tests for the `choice-draft-example` contribution at the real UI
 * boundary: the example opener, the stage choice, the editor draft, and the
 * result timeline all meet in `ScreenLayout`.
 *
 * Admission: the contribution coordinates three otherwise-tested pieces
 * (choice request, editor draft, timeline registry). The integration
 * value is that a user can drive choice -> draft -> result and choice ->
 * draft -> cancel with one textarea, the right focus, and separated drafts, so
 * each path gets one test driven through rendered keys rather than controller
 * calls. Resize is the design's forward/reverse sequence with height 2 last.
 */
import { describe, expect, test } from "bun:test";
import { InputRenderable, TextareaRenderable } from "@opentui/core";
import { testRender, type JSX } from "@opentui/solid";
import { For } from "solid-js";
import { setupChoiceDraftExample } from "../contributions/choice-draft-example";
import { StageView } from "./stage";
import type { HarnessUIInstance } from "./harness-ui";
import { ScreenLayout } from "./screen";
import { useVersion } from "./state";

import { count, fixture as createFixture, RESIZE_SEQUENCE, tick } from "./test-support";

const multilineTextareas = (setup: Awaited<ReturnType<typeof testRender>>) =>
  count(
    setup.renderer.root,
    (node) => node instanceof TextareaRenderable && !(node instanceof InputRenderable),
  );

const textarea = (setup: Awaited<ReturnType<typeof testRender>>) =>
  setup.renderer.root.findDescendantById("harness-textarea") as TextareaRenderable;

function fixture() {
  const f = createFixture();
  const example = setupChoiceDraftExample(f.ui);
  f.registrations.push(example);
  return { ...f, example };
}

function ExampleTimeline(props: { ui: HarnessUIInstance<JSX.Element> }): JSX.Element {
  const version = useVersion(props.ui.controllers.timeline);
  return (
    <box flexDirection="column">
      <For each={[...(version(), props.ui.controllers.timeline.items())]}>
        {(entry) => entry.render()}
      </For>
    </box>
  );
}

async function render(f: ReturnType<typeof fixture>) {
  const setup = await testRender(() => {
    return (
      <ScreenLayout
        ui={f.ui}
        timeline={<ExampleTimeline ui={f.ui} />}
        stage={() => <StageView ui={f.ui} />}
      />
    );
  }, { width: 120, height: 40 });
  await setup.flush();
  return setup;
}

/** Opens the example contribution and waits for the list to appear. */
async function openExample(
  f: ReturnType<typeof fixture>,
  setup: Awaited<ReturnType<typeof testRender>>,
): Promise<void> {
  f.example.open();
  await tick();
  await setup.flush();
}

/** Confirms the current choice and waits for its draft to take the editor. */
async function chooseItem(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  setup.mockInput.pressEnter();
  await tick();
  await setup.flush();
}

/** A lone ESC is deferred by the stdin parser, so it needs the flush timeout. */
async function cancelWithEscape(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  setup.mockInput.pressEscape();
  await Bun.sleep(80);
  await tick();
  await setup.flush();
}

test("disposing the example cancels an active draft without appending a result", async () => {
  const f = fixture();
  f.example.open();
  const choosing = f.ui.controllers.stage.active()!.runAction("confirm");
  await tick(); expect(f.ui.controllers.editor.activeDraft()).toBe(true);
  f.dispose(); await choosing; await tick();
  expect(f.ui.controllers.editor.activeDraft()).toBe(false);
  expect(f.ui.controllers.timeline.items()).toHaveLength(0);
});

describe("choice-draft example", () => {
  test("selects stage, opens an editor draft, and appends the result on submit", async () => {
    const f = fixture();
    const setup = await render(f);

    expect(f.ui.controllers.regions.current()).toBe("editor");
    expect(multilineTextareas(setup)).toBe(1);

    await openExample(f, setup);
    expect(f.ui.controllers.regions.current()).toBe("stage");
    expect(f.ui.controllers.stage.active()?.kind).toBe("example-choice");
    const list = setup.captureCharFrame();
    expect(list).toContain("Alpha");
    expect(list).toContain("Beta");
    expect(list).toContain("Gamma");
    expect(list).toContain("▶ Alpha");

    // One screen action moves one item; a second native move would land on Gamma.
    setup.mockInput.pressArrow("down");
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("▶ Beta");

    await chooseItem(setup);
    expect(f.ui.controllers.editor.activeDraft()).toBe(true);
    expect(f.ui.controllers.regions.current()).toBe("editor");
    expect(setup.captureCharFrame()).toContain("note: Beta");
    expect(textarea(setup).plainText).toBe("");

    await setup.mockInput.typeText("beta note");
    await setup.flush();
    expect(textarea(setup).plainText).toBe("beta note");

    setup.mockInput.pressEnter();
    await tick();
    await setup.flush();

    expect(f.ui.controllers.editor.activeDraft()).toBe(false);
    expect(f.ui.controllers.stage.active()).toBeUndefined();
    expect(f.ui.controllers.regions.current()).toBe("editor");
    expect(setup.captureCharFrame()).toContain("example: Beta");
    expect(f.ui.controllers.timeline.currentItem()?.sourceText()).toBe("Beta\nbeta note");

    setup.renderer.destroy();
    f.dispose();
  });

  test("cancel keeps the list and separates the prompt and two destination drafts", async () => {
    const f = fixture();
    const setup = await render(f);

    await setup.mockInput.typeText("ordinary draft");
    await setup.flush();
    expect(textarea(setup).plainText).toBe("ordinary draft");

    await openExample(f, setup);
    expect(setup.captureCharFrame()).toContain("▶ Alpha");

    // Alpha: a fresh destination does not inherit the prompt draft.
    await chooseItem(setup);
    expect(textarea(setup).plainText).toBe("");
    await setup.mockInput.typeText("alpha note");
    await setup.flush();

    await cancelWithEscape(setup);
    expect(f.ui.controllers.regions.current()).toBe("stage");
    expect(f.ui.controllers.timeline.items()).toHaveLength(0);
    expect(setup.captureCharFrame()).toContain("▶ Alpha");
    // Cancelling restores the untouched prompt draft behind the list.
    expect(textarea(setup).plainText).toBe("ordinary draft");

    // Beta: a second destination has its own empty draft.
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await chooseItem(setup);
    expect(textarea(setup).plainText).toBe("");
    await setup.mockInput.typeText("beta note");
    await setup.flush();
    await cancelWithEscape(setup);
    expect(f.ui.controllers.regions.current()).toBe("stage");
    expect(f.ui.controllers.timeline.items()).toHaveLength(0);

    // Back to Alpha: its draft comes back, not Beta's.
    setup.mockInput.pressArrow("up");
    await setup.flush();
    await chooseItem(setup);
    expect(textarea(setup).plainText).toBe("alpha note");
    await cancelWithEscape(setup);

    // Closing the list returns to the prompt draft.
    await cancelWithEscape(setup);
    expect(f.ui.controllers.stage.active()).toBeUndefined();
    expect(f.ui.controllers.regions.current()).toBe("editor");
    expect(textarea(setup).plainText).toBe("ordinary draft");
    expect(f.ui.controllers.timeline.items()).toHaveLength(0);

    setup.renderer.destroy();
    f.dispose();
  });

  test("keeps the cursor item and draft across the forward/reverse resize sequence", async () => {
    const f = fixture();
    const setup = await render(f);

    await openExample(f, setup);
    setup.mockInput.pressArrow("down");
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("▶ Beta");
    await chooseItem(setup);
    await setup.mockInput.typeText("beta draft");
    await setup.flush();
    expect(textarea(setup).plainText).toBe("beta draft");

    for (const [width, height] of [...RESIZE_SEQUENCE, ...[...RESIZE_SEQUENCE].reverse()]) {
      setup.resize(width, height);
      await setup.renderOnce();
      await setup.flush();

      const timeline = setup.renderer.root.findDescendantById("harness-timeline");
      expect(timeline!.width).toBe(width);
      expect(timeline!.height).toBe(height);

      const editorBox = setup.renderer.root.findDescendantById("harness-editor");
      expect(editorBox!.y).toBeGreaterThanOrEqual(0);
      expect(editorBox!.y + editorBox!.height).toBe(height);

      const stage = setup.renderer.root.findDescendantById("harness-stage");
      if (stage) {
        expect(stage.y).toBeGreaterThanOrEqual(0);
        expect(stage.y + stage.height).toBeLessThanOrEqual(editorBox!.y);
      }

      expect(count(setup.renderer.root, (node) => node.focused)).toBe(1);
      expect(multilineTextareas(setup)).toBe(1);
      expect(textarea(setup).plainText).toBe("beta draft");
      if (height > 2) {
        expect(setup.captureCharFrame()).toContain("▶ Beta");
      }
    }

    // The draft is still the cursor item's, so submitting records Beta.
    setup.mockInput.pressEnter();
    await tick();
    await setup.flush();
    expect(f.ui.controllers.editor.activeDraft()).toBe(false);
    expect(setup.captureCharFrame()).toContain("example: Beta");
    expect(f.ui.controllers.timeline.currentItem()?.sourceText()).toBe("Beta\nbeta draft");

    setup.renderer.destroy();
    f.dispose();
  });
});
