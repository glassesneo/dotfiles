/**
 * Behavioral tests for the structured timeline model and its actions.
 *
 * Admission: the fence splitter, session projection, and cursor/scroll/copy
 * behavior are repository-owned, and a wrong result is consumer-visible (a
 * drifting part id loses a streaming update, a scroll target lands behind the
 * editor overlay, or a copy writes the rendered body
 * instead of the raw source). Type and build checks cannot see those, so each
 * concern gets one test at its smallest stable boundary: the pure functions for
 * the model, a fake scrollbox plus the native Timeline engine for the actions,
 * and one renderer test for the spacer contract. Native host/OSC52 delivery is
 * faked here and intentionally left to the tmux check.
 */
import { describe, expect, test } from "bun:test";
import { engine } from "@opentui/core";
import { ManualClock } from "@opentui/core/testing";
import { testRender, type JSX } from "@opentui/solid";
import {
  reduceSessionEntries,
  sessionEntriesFromMessages,
  splitFencedBlocks,
  type SessionEntry,
} from "../core/session-entries";
import { ItemTypeRegistry, type ItemType } from "./controllers";
import { createItemActions, type TimelineScrollBox } from "./item-actions";
import { createSessionItemTypes, projectSession, TimelineView } from "./timeline";

const noteType: ItemType<{ text: string }, string> = {
  kind: "note",
  render: ({ value }) => value.text,
  sourceText: (value) => value.text,
  actions: {},
};

function timelineWithNotes(...texts: string[]) {
  const timeline = new ItemTypeRegistry<string>();
  const factory = timeline.registerType(noteType);
  const entries = texts.map((text) => factory.create({ text }));
  for (const entry of entries) {
    timeline.append(entry);
  }
  return timeline;
}

function fakeBox(options: {
  rows?: Record<string, { y: number; height: number }>;
  height: number;
  scrollHeight: number;
  scrollTop?: number;
}): TimelineScrollBox {
  return {
    scrollTop: options.scrollTop ?? 0,
    scrollHeight: options.scrollHeight,
    height: options.height,
    y: 0,
    getRenderable(id) {
      const row = options.rows?.[id];
      return row ? { ...row, y: row.y - this.scrollTop } : undefined;
    },
  };
}

/** Advances a ManualClock and steps the native engine by the elapsed time. */
function frameDriver(): (ms: number) => void {
  const clock = new ManualClock();
  let last = clock.now();
  return (ms: number) => {
    clock.advance(ms);
    engine.update(clock.now() - last);
    last = clock.now();
  };
}

test("live reducer advances streaming versions and retains original tool result text from live/history", () => {
  const event = (value: unknown) => value as Parameters<typeof reduceSessionEntries>[1];
  const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop" });
  let entries = reduceSessionEntries([], event({ type: "message_update", message: assistant("first") }));
  const id = entries[0]!.id;
  entries = reduceSessionEntries(entries, event({ type: "message_update", message: assistant("first second") }));
  expect(entries[0]!.id).toBe(id); expect(entries[0]!.version).toBe(1);
  entries = reduceSessionEntries(entries, event({ type: "message_end", message: assistant("first second") }));
  expect(entries[0]!.id).toBe(id); expect(entries[0]!.version).toBe(2);
  entries = reduceSessionEntries(entries, event({ type: "tool_execution_start", toolCallId: "raw", toolName: "read" }));
  entries = reduceSessionEntries(entries, event({ type: "tool_execution_end", toolCallId: "raw", isError: false, result: { content: [{ type: "text", text: "original\\nresult" }] } }));
  const types = createSessionItemTypes();
  expect(projectSession(entries, types).find((entry) => entry.id === "raw")!.sourceText()).toBe("original\\nresult");
  const history = sessionEntriesFromMessages([
    { role: "assistant", content: [{ type: "toolCall", id: "history-tool", name: "read", arguments: {} }], stopReason: "toolUse" },
    { role: "toolResult", toolCallId: "history-tool", content: [{ type: "text", text: "original\\nresult" }], isError: false },
  ] as unknown as Parameters<typeof sessionEntriesFromMessages>[0]);
  expect(projectSession(history, types).find((entry) => entry.id === "history-tool")!.sourceText()).toBe("original\\nresult");
});

describe("splitFencedBlocks", () => {
  test("keeps a backtick block raw, with its language and body separate", () => {
    const blocks = splitFencedBlocks("before\n```ts\nconst x = 1;\n```\nafter");
    expect(blocks).toEqual([
      { type: "text", text: "before" },
      {
        type: "code",
        language: "ts",
        body: "const x = 1;",
        sourceText: "```ts\nconst x = 1;\n```",
      },
      { type: "text", text: "after" },
    ]);
  });

  test("accepts tilde fences and treats an unclosed fence as text", () => {
    const tilde = splitFencedBlocks("~~~\nbody\n~~~");
    expect(tilde).toEqual([
      { type: "code", language: "", body: "body", sourceText: "~~~\nbody\n~~~" },
    ]);

    const unclosed = splitFencedBlocks("```sh\necho hi");
    expect(unclosed).toEqual([{ type: "text", text: "```sh\necho hi" }]);
  });

  test("does not mistake an inline triple for a block start", () => {
    expect(splitFencedBlocks("a ``` b")).toEqual([{ type: "text", text: "a ``` b" }]);
    expect(splitFencedBlocks("")).toEqual([]);
  });
});

describe("projectSession", () => {
  const types = createSessionItemTypes();

  test("derives stable assistant part ids and keeps the raw code block as source", () => {
    const entries: SessionEntry[] = [
      {
        kind: "assistant",
        id: "msg-1",
        version: 4,
        text: "hello\n```ts\nconst x = 1;\n```\nbye",
        streaming: false,
      },
    ];
    const projected = projectSession(entries, types);
    expect(projected.map((entry) => entry.id)).toEqual([
      "msg-1:part:0",
      "msg-1:part:1",
      "msg-1:part:2",
    ]);
    expect(projected.map((entry) => entry.kind)).toEqual(["assistant", "code", "assistant"]);
    expect(projected.map((entry) => entry.version)).toEqual([4, 4, 4]);
    expect(projected[1]?.sourceText()).toBe("```ts\nconst x = 1;\n```");
  });

  test("keeps the part ids and raises the version as a streamed message grows", () => {
    const before = projectSession(
      [{ kind: "assistant", id: "msg-2", version: 0, text: "one", streaming: true }],
      types,
    );
    const after = projectSession(
      [{ kind: "assistant", id: "msg-2", version: 1, text: "one two", streaming: true }],
      types,
    );
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.version).toBe(1);
    expect(before[0]?.version).toBe(0);

    const final = projectSession(
      [{ kind: "assistant", id: "msg-2", version: 2, text: "one two", streaming: false }],
      types,
    );
    expect(final[0]?.id).toBe(before[0]?.id);
  });

  test("keeps entry ids for user, tool, and notice, with the raw tool result", () => {
    const entries: SessionEntry[] = [
      { kind: "user", id: "user-1", version: 0, text: "ask" },
      {
        kind: "tool",
        id: "call-1",
        version: 1,
        name: "bash",
        status: "done",
        sourceText: "total 2\nfile",
      },
      { kind: "notice", id: "notice-1", version: 0, level: "warning", text: "careful" },
    ];
    const projected = projectSession(entries, types);
    expect(projected.map((entry) => entry.id)).toEqual(["user-1", "call-1", "notice-1"]);
    expect(projected.map((entry) => entry.kind)).toEqual(["user", "tool", "notice"]);
    expect(projected[1]?.sourceText()).toBe("total 2\nfile");
  });

  test("lets a built-in kind be disposed and registered again", () => {
    const timeline = new ItemTypeRegistry<JSX.Element>();
    const first = timeline.registerType(types.code);
    expect(() => timeline.registerType(types.code)).toThrow();
    first.dispose();
    expect(() => timeline.registerType(types.code)).not.toThrow();
  });
});

describe("timeline actions", () => {
  test("moves the cursor and scrolls it above the editor overlay", () => {
    const timeline = timelineWithNotes("a", "b", "c");
    const box = fakeBox({
      rows: {
        "timeline-0": { y: 0, height: 3 },
        "timeline-1": { y: 3, height: 3 },
        "timeline-2": { y: 6, height: 3 },
      },
      height: 6,
      scrollHeight: 12,
    });
    const actions = createItemActions({
      timeline,
      scrollbox: () => box,
      overlayHeight: () => 2,
    });
    const frame = frameDriver();
    try {
      actions.move(1);
      frame(120);
      expect(box.scrollTop).toBe(2);

      actions.move(1);
      frame(120);
      // The item's end aligns with the overlay's top edge: 6..9 in 5..9.
      expect(box.scrollTop).toBe(5);

      // An item already inside the visible region does not move the scroll.
      actions.move(0);
      frame(120);
      expect(box.scrollTop).toBe(5);
    } finally {
      void actions.dispose();
    }
  });

  test("adds repeated page input to the in-flight target and clamps at the ends", () => {
    const timeline = timelineWithNotes("a", "b", "c");
    const box = fakeBox({ height: 10, scrollHeight: 100 });
    const actions = createItemActions({
      timeline,
      scrollbox: () => box,
      overlayHeight: () => 0,
    });
    const frame = frameDriver();
    try {
      actions.scroll("half-down");
      frame(60);
      actions.scroll("half-down");
      frame(120);
      expect(box.scrollTop).toBe(10);

      box.scrollTop = 90;
      actions.scroll("page-down");
      frame(120);
      expect(box.scrollTop).toBe(90);

      box.scrollTop = 0;
      actions.scroll("page-up");
      frame(120);
      expect(box.scrollTop).toBe(0);
    } finally {
      void actions.dispose();
    }
  });

  test("copies the source text, not the render, and reports neither success nor a notice", async () => {
    const timeline = new ItemTypeRegistry<string>();
    const factory = timeline.registerType({
      kind: "raw",
      render: ({ value }) => `rendered:${value}`,
      sourceText: (value) => `raw:${value}`,
      actions: {},
    });
    timeline.append(factory.create("alpha"));

    const written: string[] = [];
    const notices: string[] = [];
    const actions = createItemActions({
      timeline,
      scrollbox: () => undefined,
      overlayHeight: () => 0,
      clipboard: {
        writeText: async (text) => {
          written.push(text);
          return true;
        },
        dispose: async () => {},
      },
      notify: (level, text) => notices.push(`${level}:${text}`),
    });

    await expect(actions.copy()).resolves.toBe(true);
    expect(written).toEqual(["raw:alpha"]);
    expect(notices).toEqual([]);
  });

  test("emits an error notice when no backend takes the text", async () => {
    const timeline = timelineWithNotes("a", "b");
    const notices: string[] = [];
    const actions = createItemActions({
      timeline,
      scrollbox: () => undefined,
      overlayHeight: () => 0,
      clipboard: {
        writeText: async () => false,
        dispose: async () => {},
      },
      notify: (level, text) => notices.push(`${level}:${text}`),
    });

    await expect(actions.copy()).resolves.toBe(false);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.startsWith("error:")).toBe(true);
  });

  test("does nothing without a cursor item and disposes its clipboard once", async () => {
    const timeline = new ItemTypeRegistry<string>();
    timeline.registerType(noteType);
    let disposed = 0;
    const actions = createItemActions({
      timeline,
      scrollbox: () => undefined,
      overlayHeight: () => 0,
      clipboard: {
        writeText: async () => true,
        dispose: async () => {
          disposed += 1;
        },
      },
    });

    await expect(actions.copy()).resolves.toBe(false);
    await actions.dispose();
    expect(disposed).toBe(1);
  });
});

test("native timeline cursor remains visible after scrolling and moving in both directions", async () => {
  const timeline = new ItemTypeRegistry<JSX.Element>();
  const factory = timeline.registerType({ kind: "native-note", render: ({ value }: { value: string }) => <text>{value}</text>, sourceText: (value: string) => value, actions: {} });
  for (const label of ["first", "middle", "last"]) timeline.append(factory.create((label + "\\n").repeat(12)));
  let box: TimelineScrollBox | undefined;
  const setup = await testRender(() => <TimelineView timeline={timeline} overlayHeight={4} scrollRef={(value) => { box = value; }} />, { width: 40, height: 16 });
  await setup.flush();
  const actions = createItemActions({ timeline, scrollbox: () => box, overlayHeight: () => 4 });
  actions.move(0); engine.update(120); await setup.flush();
  expect(box!.scrollTop).toBe(0);
  for (const delta of [2, -1, 1]) {
    actions.move(delta); engine.update(120); await setup.flush();
    const row = box!.getRenderable(timeline.cursor()!)!;
    expect(row.y + row.height).toBeLessThanOrEqual(box!.y + box!.height - 4);
  }
  await actions.dispose(); setup.renderer.destroy();
});

describe("TimelineView", () => {
  test("adds a spacer as tall as the overlay and exposes its scrollbox", async () => {
    const timeline = new ItemTypeRegistry<JSX.Element>();
    const types = createSessionItemTypes();
    timeline.registerType(types.user);
    timeline.registerType(types.assistant);
    timeline.registerType(types.code);
    timeline.registerType(types.tool);
    timeline.registerType(types.notice);
    timeline.replace(
      projectSession([{ kind: "user", id: "user-1", version: 0, text: "hi" }], types),
    );

    let box: TimelineScrollBox | undefined;
    const setup = await testRender(
      () => (
        <TimelineView
          timeline={timeline}
          overlayHeight={2}
          queued={["next"]}
          scrollRef={(element) => {
            box = element;
          }}
        />
      ),
      { width: 60, height: 20 },
    );
    await setup.flush();

    expect(setup.renderer.root.findDescendantById("timeline-spacer")?.height).toBe(2);
    expect(typeof box?.getRenderable).toBe("function");
    expect(setup.captureCharFrame()).toContain("queued: next");

    setup.renderer.destroy();
  });
});
