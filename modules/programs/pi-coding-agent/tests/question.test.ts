import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import registerQuestion, { createQuestionToolDefinition } from "../extensions_src/question.ts";
import type { QuestionResultDetails } from "../extensions_src/utilities/decision_core.ts";
import { extensionContext as context, textResult as resultText } from "./test_helpers.ts";

const params = {
  questions: [
    {
      id: "choice",
      prompt: "Choose",
      kind: "single" as const,
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    },
  ],
};

void test("extension registers the question tool for sequential execution", () => {
  let registered: ReturnType<typeof createQuestionToolDefinition> | undefined;
  registerQuestion({
    registerTool(tool) {
      registered = tool as unknown as ReturnType<
        typeof createQuestionToolDefinition
      >;
    },
  } as ExtensionAPI);

  assert.equal(registered?.name, "question");
  assert.equal(registered?.executionMode, "sequential");
});

void test("non-interactive and print modes return unavailable without UI", async () => {
  const tool = createQuestionToolDefinition();
  for (const mode of ["print", "json"] as const) {
    const result = await tool.execute(
      "call",
      params,
      undefined,
      undefined,
      context({ mode, hasUI: true }),
    );
    assert.deepEqual(result.details, { status: "unavailable", responses: {} });
    assert.deepEqual(JSON.parse(resultText(result.content[0])), result.details);
  }
});

void test("RPC dispatch uses standard dialogs and preserves content/details", async () => {
  const tool = createQuestionToolDefinition();
  const script = ["[ ] B", "because", "Submit responses"];
  const result = await tool.execute(
    "call",
    params,
    undefined,
    undefined,
    context({
      mode: "rpc",
      hasUI: true,
      ui: {
        async select() {
          return script.shift();
        },
        async editor() {
          return script.shift();
        },
      },
    }),
  );
  assert.deepEqual(result.details, {
    status: "submitted",
    responses: {
      choice: { kind: "single", value: "b", note: "because" },
    },
  });
  assert.deepEqual(JSON.parse(resultText(result.content[0])), result.details);
});

void test("TUI dispatch uses one custom UI through confirmation", async () => {
  const tool = createQuestionToolDefinition();
  let customCalls = 0;
  const result = await tool.execute(
    "call",
    params,
    undefined,
    undefined,
    context({
      mode: "tui",
      hasUI: true,
      ui: {
        async custom(factory) {
          customCalls += 1;
          let resolved: QuestionResultDetails | undefined;
          const component = await factory(
            {
              terminal: { rows: 24, columns: 80 },
              requestRender() { },
            } as TUI,
            { fg: (_color: string, text: string) => text } as never,
            {
              getKeys(action: string) {
                return ({
                  "tui.select.confirm": ["enter"],
                  "tui.select.up": ["up"],
                  "tui.select.down": ["down"],
                  "tui.input.submit": ["enter"],
                  "tui.input.newLine": ["shift+enter", "ctrl+j"],
                } as Record<string, string[]>)[action] ?? [];
              }
            } as never,
            value => { resolved = value as QuestionResultDetails; },
          );
          component.handleInput?.("\r");
          component.handleInput?.("\r");
          component.dispose?.();
          return resolved as never;
        },
      },
    }),
  );
  assert.equal(customCalls, 1);
  assert.deepEqual(result.details, {
    status: "submitted",
    responses: { choice: { kind: "single", value: "a" } },
  });
});

void test("tool renderers show question prompts, responses, notes, and untouched state", () => {
  const tool = createQuestionToolDefinition();
  const renderTheme = { fg: (_color: string, text: string) => text } as never;
  const args = {
    questions: [
      params.questions[0],
      { id: "details", prompt: "Explain", kind: "single" as const, options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] },
    ],
  };
  const call = tool.renderCall?.(args, renderTheme, {} as never);
  const callText = call?.render(120).join("\n") ?? "";
  assert.match(callText, /Choose/);
  assert.match(callText, /Explain/);

  const result = {
    content: [{ type: "text", text: "" }],
    details: {
      status: "submitted",
      responses: {
        choice: { kind: "single", value: "b", note: "because" },
        details: { kind: "write-in", value: "need another path" },
      },
    },
  } as never;
  const collapsed = tool.renderResult?.(result, { expanded: false } as never, renderTheme, { args } as never);
  const collapsedText = collapsed?.render(160).join("\n") ?? "";
  assert.match(collapsedText, /2\s+answered/i);
  assert.match(collapsedText, /0\s+untouched/i);
  assert.match(collapsedText, /B/);
  assert.match(collapsedText, /because/);
  assert.match(collapsedText, /need another path/);
  assert.doesNotMatch(collapsedText, /Choose|Explain/);
});

void test("multi tool results keep each option note paired in collapsed and expanded output", () => {
  const tool = createQuestionToolDefinition();
  const renderTheme = { fg: (_color: string, text: string) => text } as never;
  const args = {
    questions: [{
      id: "targets",
      prompt: "Targets",
      kind: "multi" as const,
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    }],
  };
  const result = {
    content: [{ type: "text", text: "" }],
    details: {
      status: "submitted",
      responses: { targets: { kind: "multi", values: [{ value: "a", note: "first\nline" }, { value: "b", note: "second" }], writeIn: "another" } },
    },
  } as never;
  const collapsed = tool.renderResult?.(result, { expanded: false } as never, renderTheme, { args } as never)?.render(160).join("\n") ?? "";
  const collapsedOrder = ["A", "first", "line", "B", "second", "another"].map(value => collapsed.indexOf(value));
  assert.ok(collapsedOrder.every(index => index >= 0));
  assert.deepEqual(collapsedOrder, [...collapsedOrder].sort((left, right) => left - right));
  const expanded = tool.renderResult?.(result, { expanded: true } as never, renderTheme, { args } as never)?.render(160).join("\n") ?? "";
  assert.match(expanded, /A[\s\S]*first[\s\S]*line[\s\S]*B[\s\S]*second/);
  assert.doesNotMatch(expanded, /Targets/);
});

void test("runtime contract violations throw tool errors before UI", async () => {
  const tool = createQuestionToolDefinition();
  await assert.rejects(
    tool.execute(
      "call",
      {
        questions: [
          params.questions[0],
          { ...params.questions[0], prompt: "Duplicate" },
        ],
      },
      undefined,
      undefined,
      context({ mode: "rpc", hasUI: true }),
    ),
    /id must be unique/,
  );
  await assert.rejects(
    tool.execute(
      "call",
      { questions: [{ ...params.questions[0], notePlaceholder: "legacy" }] } as never,
      undefined,
      undefined,
      context({ mode: "rpc", hasUI: true }),
    ),
    /notePlaceholder is not supported/,
  );
  await assert.rejects(
    tool.execute(
      "call",
      { questions: [{ ...params.questions[0], note: { mode: "answer" } }] } as never,
      undefined,
      undefined,
      context({ mode: "rpc", hasUI: true }),
    ),
    /note is not supported/,
  );
});
