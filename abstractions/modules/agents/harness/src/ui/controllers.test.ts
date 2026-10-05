import { describe, expect, test } from "bun:test";
import {
  StageController,
  type StageContentType,
  DuplicateKeyBindingError,
  DuplicateRegistrationError,
  materializeItem,
  KeyRegistry,
  type ItemType,
  ItemTypeRegistry,
  RegionController,
} from "./controllers";
import { EditorController, maxHeight, minHeight } from "./editor-engine";
import { createHarnessControllers } from "./harness-ui";

const textType: StageContentType<string, string> = {
  kind: "text",
  defaultValue: "",
  render: ({ value }) => `text:${value}`,
  actions: {
    pick: ({ value, handle }) => handle.close(value.toUpperCase()),
  },
};

const messageType: ItemType<{ text: string }> = {
  kind: "message",
  render: ({ value }) => `msg:${value.text}`,
  sourceText: (value) => value.text,
  actions: {},
};

describe("RegionController and KeyRegistry", () => {
  test("focuses available regions and rejects unavailable ones", () => {
    const regions = new RegionController();
    expect(regions.current()).toBe("editor");

    expect(regions.requestFocus("timeline")).toBe(true);
    expect(regions.current()).toBe("timeline");
    expect(regions.requestFocus("missing")).toBe(false);
    expect(regions.current()).toBe("timeline");

    regions.setAvailable("stage", false);
    expect(regions.requestFocus("stage")).toBe(false);
    expect(regions.current()).toBe("timeline");
  });

  test("moves focus to the explicit fallback when the focused region disappears", () => {
    const regions = new RegionController();
    const extra = regions.register("extra", { fallback: "timeline" });
    expect(regions.requestFocus("extra")).toBe(true);

    regions.setAvailable("extra", false);
    expect(regions.current()).toBe("timeline");

    extra.dispose();
    expect(regions.list()).not.toContain("extra");
  });

  test("uses the explicit fallback captured before removing a focused region", () => {
    const regions = new RegionController();
    const extra = regions.register("extra", { fallback: "timeline" });
    expect(regions.requestFocus("extra")).toBe(true);

    extra.dispose();
    expect(regions.current()).toBe("timeline");
  });

  test("does not let a stale region handle remove a re-registration", () => {
    const regions = new RegionController();
    const first = regions.register("extra");
    first.dispose();
    regions.register("extra");

    first.dispose();
    expect(regions.list()).toContain("extra");
  });

  test("resolves only the current region's binding, and the caller runs it once", () => {
    const keys = new KeyRegistry();
    const regions = new RegionController({ keys });
    let promptHits = 0;
    let outputHits = 0;
    keys.register("test", "editor", [{ actionId: "editor.test", name: "c", ctrl: true, action: () => promptHits++ }]);
    keys.register("test", "timeline", [{ actionId: "timeline.test", name: "c", ctrl: true, action: () => outputHits++ }]);

    const promptAction = regions.resolve({ name: "c", ctrl: true });
    expect(promptAction).toBeFunction();
    promptAction?.();
    expect(promptHits).toBe(1);
    expect(outputHits).toBe(0);

    expect(regions.resolve({ name: "x" })).toBeUndefined();

    regions.requestFocus("timeline");
    const outputAction = regions.resolve({ name: "c", ctrl: true });
    expect(outputAction).toBeFunction();
    outputAction?.();
    expect(promptHits).toBe(1);
    expect(outputHits).toBe(1);
  });

  test("rejects a colliding batch atomically and allows cross-region reuse", () => {
    const keys = new KeyRegistry();
    const first = keys.register("a", "editor", [{ actionId: "editor.first", name: "j", action: () => {} }]);
    expect(() =>
      keys.register("b", "editor", [
        { actionId: "editor.second", name: "k", action: () => {} },
        { actionId: "editor.third", name: "j", action: () => {} },
      ]),
    ).toThrow(DuplicateKeyBindingError);
    expect(keys.resolve("editor", { name: "k" })).toBeUndefined();
    expect(keys.resolve("editor", { name: "j" })).toBeFunction();

    expect(() =>
      keys.register("b", "editor", [
        { actionId: "editor.plain-n", name: "n", action: () => {} },
        { actionId: "editor.ctrl-n", name: "n", ctrl: true, action: () => {} },
        { actionId: "editor.m", name: "m", action: () => {} },
      ]),
    ).not.toThrow();
    expect(keys.resolve("stage", { name: "j" })).toBeUndefined();
    expect(() => keys.register("b", "stage", [{ actionId: "stage.j", name: "j", action: () => {} }])).not.toThrow();

    first.dispose();
    expect(keys.resolve("editor", { name: "j" })).toBeUndefined();
    expect(() => keys.register("c", "editor", [{ actionId: "editor.replacement", name: "j", action: () => {} }])).not.toThrow();
  });
});

describe("StageController", () => {
  test("serializes blocking requests and completes them", async () => {
    const regions = new RegionController();
    const stage = new StageController<string>({ regions });
    const first = stage.show({ requester: "one", type: textType, value: "a", preferredHeight: 3 });
    const second = stage.show({ requester: "two", type: textType, value: "b", preferredHeight: 3 });

    expect(stage.active()?.render()).toBe("text:a");
    expect(stage.queued()).toBe(1);
    expect(regions.current()).toBe("stage");

    first.close("chosen");
    await expect(first.closed).resolves.toEqual({ status: "closed", value: "chosen" });
    expect(stage.active()?.render()).toBe("text:b");

    second.cancel();
    await expect(second.closed).resolves.toEqual({ status: "cancelled", value: "" });
    expect(stage.active()).toBeUndefined();
    expect(regions.current()).toBe("editor");
  });

  test("cancels by signal while queued and updates render values", async () => {
    const regions = new RegionController();
    const stage = new StageController<string>({ regions });
    const blocker = stage.show({ requester: "one", type: textType, value: "a", preferredHeight: 3 });
    const controller = new AbortController();
    const queued = stage.show({
      requester: "two",
      type: textType,
      value: "b",
      preferredHeight: 3,
      signal: controller.signal,
    });

    controller.abort();
    await expect(queued.closed).resolves.toEqual({
      status: "cancelled",
      value: "",
      reason: "aborted",
    });
    expect(stage.queued()).toBe(0);

    blocker.update("c");
    expect(stage.active()?.render()).toBe("text:c");
    blocker.close();
    await blocker.closed;
    expect(regions.current()).toBe("editor");
  });

  test("runs actions and notifies only the active requester on prompt acceptance", async () => {
    const regions = new RegionController();
    const stage = new StageController<string>({ regions });
    const notified: string[] = [];
    const first = stage.show({
      requester: "one",
      type: textType,
      value: "a",
      preferredHeight: 1,
      onPromptSubmitted: ({ text }) => {
        notified.push(text);
      },
    });
    stage.show({ requester: "two", type: textType, value: "b", preferredHeight: 1 });

    await stage.active()?.runAction("pick");
    await expect(first.closed).resolves.toEqual({ status: "closed", value: "A" });
    expect(stage.active()?.requester).toBe("two");

    await stage.notifyPromptSubmitted("hello");
    expect(notified).toEqual([]);
  });

  test("rejects duplicate content kinds", () => {
    const regions = new RegionController();
    const stage = new StageController<string>({ regions });
    stage.registerType(textType);
    expect(() => stage.registerType(textType)).toThrow(DuplicateRegistrationError);
  });

  test("does not let a disposed type registration remove a later one", () => {
    const regions = new RegionController();
    const stage = new StageController<string>({ regions });
    const first = stage.registerType(textType);
    first.dispose();
    const second = stage.registerType(textType);
    first.dispose();
    expect(() => stage.registerType(textType)).toThrow(DuplicateRegistrationError);
    second.dispose();
    expect(() => stage.registerType(textType)).not.toThrow();
  });

  test("falls back to editor when the region that held focus was removed", async () => {
    const regions = new RegionController();
    const stage = new StageController<string>({ regions });
    const extra = regions.register("extra", { fallback: "timeline" });
    expect(regions.requestFocus("extra")).toBe(true);

    const handle = stage.show({ requester: "one", type: textType, value: "a", preferredHeight: 2 });
    expect(regions.current()).toBe("stage");
    extra.dispose();
    handle.close();
    await handle.closed;
    expect(regions.current()).toBe("editor");
  });

  test("does not claim automatic focus while an editor draft is active", async () => {
    const { regions, stage, editor } = createHarnessControllers<string>();
    void editor.openDraft({ destination: "a", label: "A", requester: "timeline" });
    expect(regions.current()).toBe("editor");

    const handle = stage.show({ requester: "one", type: textType, value: "a", preferredHeight: 2 });
    expect(regions.current()).toBe("editor");

    handle.close();
    await handle.closed;
    expect(regions.current()).toBe("editor");

    editor.cancelDraft();
    const later = stage.show({ requester: "two", type: textType, value: "b", preferredHeight: 2 });
    expect(regions.current()).toBe("stage");
    later.cancel();
    await later.closed;
  });

  test("makes stage focusable only while an assist exists and keeps blocking priority", async () => {
    const { regions, stage, editor } = createHarnessControllers<string>();
    expect(regions.isAvailable("stage")).toBe(false);
    expect(regions.requestFocus("stage")).toBe(false);

    // A nonempty assist contributes availability without taking focus.
    editor.setAssist({ items: ["a"], cursor: 0 });
    expect(regions.current()).toBe("editor");
    expect(regions.isAvailable("stage")).toBe(true);
    expect(regions.requestFocus("stage")).toBe(true);

    // An empty assist contributes no availability.
    editor.setAssist({ items: [], cursor: 0 });
    expect(regions.isAvailable("stage")).toBe(false);
    expect(regions.requestFocus("stage")).toBe(false);
    expect(regions.current()).toBe("editor");

    // Clearing it revokes availability and moves focus off the empty stage.
    editor.setAssist(undefined);
    expect(regions.isAvailable("stage")).toBe(false);
    expect(regions.current()).toBe("editor");

    // An active request keeps the region available; an assist keeps it
    // available after the request closes, and clearing it revokes it again.
    const handle = stage.show({ requester: "one", type: textType, value: "a", preferredHeight: 2 });
    expect(regions.current()).toBe("stage");
    editor.setAssist({ items: ["b"], cursor: 0 });
    handle.cancel();
    await handle.closed;
    expect(regions.isAvailable("stage")).toBe(true);
    editor.setAssist(undefined);
    expect(regions.isAvailable("stage")).toBe(false);
  });
});

describe("ItemTypeRegistry", () => {
  test("registers typed factories and keeps stable ids on upsert", () => {
    const timeline = new ItemTypeRegistry();
    const factory = timeline.registerType(messageType);
    expect(() => timeline.registerType(messageType)).toThrow(DuplicateRegistrationError);

    const first = factory.create({ text: "one" });
    timeline.append(first);
    timeline.append({ ...first, version: 1, value: { text: "two" } });

    expect(timeline.items()).toHaveLength(1);
    expect(timeline.items()[0]?.version).toBe(1);
    expect(timeline.items()[0]?.sourceText()).toBe("two");
    expect(timeline.currentItem()?.id).toBe(first.id);
    factory.dispose();
    expect(() => timeline.registerType(messageType)).not.toThrow();
  });

  test("places the cursor on first append and moves it with clamping", () => {
    const timeline = new ItemTypeRegistry();
    const factory = timeline.registerType(messageType);
    expect(timeline.currentItem()).toBeUndefined();

    const a = factory.create({ text: "a" });
    const b = factory.create({ text: "b" });
    const c = factory.create({ text: "c" });
    timeline.append(a);
    timeline.append(b);
    timeline.append(c);
    expect(timeline.currentItem()?.id).toBe(a.id);

    timeline.moveCursor(1);
    expect(timeline.currentItem()?.id).toBe(b.id);
    timeline.moveCursor(10);
    expect(timeline.currentItem()?.id).toBe(c.id);
    timeline.moveCursor(-10);
    expect(timeline.currentItem()?.id).toBe(a.id);
  });

  test("reconciles replaced items against the previous cursor index", () => {
    const timeline = new ItemTypeRegistry();
    const factory = timeline.registerType(messageType);
    const a = factory.create({ text: "a" });
    const b = factory.create({ text: "b" });
    const c = factory.create({ text: "c" });
    timeline.replace([a, b, c].map(materializeItem));

    timeline.setCursor(b.id);
    timeline.replace([a, c].map(materializeItem));
    expect(timeline.currentItem()?.id).toBe(a.id);

    timeline.setCursor(a.id);
    timeline.replace([c, b].map(materializeItem));
    expect(timeline.currentItem()?.id).toBe(c.id);

    timeline.replace([]);
    expect(timeline.currentItem()).toBeUndefined();
  });

  test("clears the cursor when the removed index has no neighbour", () => {
    const timeline = new ItemTypeRegistry();
    const factory = timeline.registerType(messageType);
    const a = factory.create({ text: "a" });
    const b = factory.create({ text: "b" });
    const c = factory.create({ text: "c" });
    timeline.replace([a, b, c].map(materializeItem));

    timeline.setCursor(c.id);
    timeline.replace([a].map(materializeItem));
    expect(timeline.currentItem()).toBeUndefined();

    timeline.setCursor(b.id);
    timeline.replace([].map(materializeItem));
    expect(timeline.currentItem()).toBeUndefined();
  });

  test("does not let a disposed type registration remove a later one", () => {
    const timeline = new ItemTypeRegistry();
    const first = timeline.registerType(messageType);
    first.dispose();
    const second = timeline.registerType(messageType);
    first.dispose();
    expect(() => timeline.registerType(messageType)).toThrow(DuplicateRegistrationError);
    second.dispose();
    expect(() => timeline.registerType(messageType)).not.toThrow();
  });
});

describe("EditorController", () => {
  function fakeRegions() {
    const focus: string[] = [];
    let current = "editor";
    return {
      focus,
      regions: {
        requestFocus(region: string) {
          focus.push(region);
          current = region;
          return true;
        },
        get current() {
          return current;
        },
      },
    };
  }

  test("keeps the prompt draft separate from destination drafts", () => {
    const { regions } = fakeRegions();
    const editor = new EditorController({ regions });
    editor.setText("prompt");

    void editor.openDraft({ destination: "a", label: "A", requester: "stage" });
    expect(editor.snapshot().mode).toBe("draft");
    expect(editor.text()).toBe("");
    editor.setText("draft a");
    editor.cancelDraft();

    expect(editor.text()).toBe("prompt");

    void editor.openDraft({ destination: "b", label: "B", requester: "stage", initialText: "prefill" });
    expect(editor.text()).toBe("prefill");
    editor.setText("draft b");
    editor.submitDraft();

    expect(editor.text()).toBe("prompt");
    for (const [destination, text] of [["a", "draft a"], ["b", "draft b"]]) {
      void editor.openDraft({ destination, label: destination, requester: "stage" });
      expect(editor.text()).toBe(text);
      editor.cancelDraft();
    }
  });

  test("queues drafts FIFO and restores the requester's focus", async () => {
    const { regions, focus } = fakeRegions();
    const editor = new EditorController({ regions });
    let secondSettled = false;
    const first = editor.openDraft({ destination: "a", label: "A", requester: "timeline" });
    const second = editor.openDraft({ destination: "b", label: "B", requester: "timeline" });
    void second.then(() => {
      secondSettled = true;
    });

    expect(editor.snapshot().destination).toBe("a");
    editor.setText("answer");
    editor.submitDraft();
    await expect(first).resolves.toEqual({ status: "submitted", text: "answer" });
    expect(focus).toContain("timeline");

    await Promise.resolve();
    expect(secondSettled).toBe(false);
    expect(editor.snapshot().destination).toBe("b");
    editor.cancelDraft();
    await expect(second).resolves.toEqual({ status: "cancelled" });
    expect(editor.activeDraft()).toBe(false);
  });

  test("cancels a queued or active draft on abort", async () => {
    const { regions } = fakeRegions();
    const editor = new EditorController({ regions });
    const first = editor.openDraft({ destination: "a", label: "A", requester: "stage" });
    const controller = new AbortController();
    const second = editor.openDraft({
      destination: "b",
      label: "B",
      requester: "stage",
      signal: controller.signal,
    });

    controller.abort();
    await expect(second).resolves.toEqual({ status: "cancelled" });

    editor.cancelDraft();
    await expect(first).resolves.toEqual({ status: "cancelled" });
  });

  test("does not overwrite a retained destination draft with initialText", () => {
    const { regions } = fakeRegions();
    const editor = new EditorController({ regions });
    for (const text of ["kept", ""]) {
      void editor.openDraft({ destination: "a", label: "A", requester: "stage" });
      editor.setText(text);
      editor.cancelDraft();
      void editor.openDraft({ destination: "a", label: "A", requester: "stage", initialText: "ignored" });
      expect(editor.text()).toBe(text);
      editor.cancelDraft();
    }
  });

  test("clears the prompt draft only when the session accepts it", async () => {
    const { regions } = fakeRegions();
    const accepted: string[] = [];
    let accept = false;
    const editor = new EditorController({
      regions,
      sendPrompt: async () => accept,
      onPromptAccepted: (text) => {
        accepted.push(text);
      },
    });

    editor.setText("  hello  ");
    expect(await editor.submitPrompt()).toBe(false);
    expect(editor.text()).toBe("  hello  ");
    expect(accepted).toEqual([]);

    accept = true;
    expect(await editor.submitPrompt()).toBe(true);
    expect(editor.text()).toBe("");
    expect(accepted).toEqual(["hello"]);
  });

  test("refuses a prompt submit while a draft owns the editor", async () => {
    const { regions } = fakeRegions();
    let sends = 0;
    const editor = new EditorController({
      regions,
      sendPrompt: async () => {
        sends++;
        return true;
      },
    });
    editor.setText("prompt");
    void editor.openDraft({ destination: "a", label: "A", requester: "stage" });

    expect(await editor.submitPrompt()).toBe(false);
    expect(sends).toBe(0);
    expect(editor.activeDraft()).toBe(true);
  });

  test("sends a prompt once while a submission is in flight", async () => {
    const { regions } = fakeRegions();
    let release!: (value: boolean) => void;
    let calls = 0;
    const editor = new EditorController({
      regions,
      sendPrompt: () => {
        calls++;
        return new Promise<boolean>((resolve) => {
          release = resolve;
        });
      },
    });

    editor.setText("hello");
    const first = editor.submitPrompt();
    expect(await editor.submitPrompt()).toBe(false);
    expect(calls).toBe(1);
    release(true);
    expect(await first).toBe(true);
  });

  test("tells the requester about an accepted send even if the draft changed, swallowing failures", async () => {
    const { regions } = fakeRegions();
    let release!: (value: boolean) => void;
    const accepted: string[] = [];
    const editor = new EditorController({
      regions,
      sendPrompt: () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
      onPromptAccepted: (text) => {
        accepted.push(text);
        throw new Error("requester failed");
      },
    });

    editor.setText("hello");
    const send = editor.submitPrompt();
    editor.setText("hello again");
    release(true);
    expect(await send).toBe(true);
    expect(accepted).toEqual(["hello"]);
    expect(editor.text()).toBe("hello again");
  });

  test("clamps the reported height and forwards focus targets", () => {
    const { regions, focus } = fakeRegions();
    const editor = new EditorController({ regions });
    editor.reportHeight(100);
    expect(editor.snapshot().preferredHeight).toBe(maxHeight);
    editor.reportHeight(0);
    expect(editor.snapshot().preferredHeight).toBe(minHeight);

    editor.requestFocus("timeline");
    editor.requestFocus("stage");
    expect(focus).toContain("timeline");
    expect(focus).toContain("stage");
  });

  test("clears the transient assist on draft settle and falls back when the requester is gone", () => {
    const { regions } = fakeRegions();
    const focus: string[] = [];
    let allowsBorrower = false;
    const editor = new EditorController({
      regions: {
        requestFocus: (region: string) => {
          focus.push(region);
          if (region === "missing") {
            return allowsBorrower;
          }
          return true;
        },
      },
    });

    void editor.openDraft({ destination: "a", label: "A", requester: "missing" });
    editor.setAssist({ items: ["x"], cursor: 0 });
    editor.cancelDraft();

    expect(editor.snapshot().assist).toBeUndefined();
    expect(focus.at(-1)).toBe("editor");
  });
});
