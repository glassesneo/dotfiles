import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import registerQuestion, { createQuestionToolDefinition } from "../extensions_src/question.ts";
import type { QuestionResultDetails } from "../extensions_src/utilities/decision_core.ts";
import { extensionContext as context } from "./test_helpers.ts";

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

void test("non-interactive modes do not dispatch a question UI", async () => {
  const tool = createQuestionToolDefinition();
  for (const mode of ["print", "json"] as const) {
    const result = await tool.execute(
      "call",
      params,
      undefined,
      undefined,
      context({ mode, hasUI: true }),
    );
    assert.equal(result.details?.status, "unavailable");
  }
});

void test("RPC dispatch uses standard dialogs", async () => {
  const tool = createQuestionToolDefinition();
  const script = ["[ ] B", "because", "Submit responses"];
  let selectCalls = 0;
  let editorCalls = 0;
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
          selectCalls += 1;
          return script.shift();
        },
        async editor() {
          editorCalls += 1;
          return script.shift();
        },
      },
    }),
  );
  assert.equal(result.details?.status, "submitted");
  assert.ok(selectCalls > 0);
  assert.equal(editorCalls, 1);
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
  assert.equal(result.details?.status, "submitted");
});
