import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import registerQuestion, {
  createQuestionToolDefinition,
  questionPromptGuidelines,
} from "../extensions_src/question.ts";
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

void test("extension registers sequential question metadata and model guidance", () => {
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
  assert.match(registered?.description ?? "", /user-owned decisions/);
  assert.match(registered?.description ?? "", /affects the current task/);
  assert.match(registered?.description ?? "", /response note/);
  assert.match(registered?.promptSnippet ?? "", /user-owned decisions/);
  assert.match(registered?.promptSnippet ?? "", /affects the current task/);
  assert.doesNotMatch(registered?.promptSnippet ?? "", /required to continue|blocker/i);
  assert.ok(questionPromptGuidelines.every(line => /`question` tool/.test(line)));
  assert.ok(questionPromptGuidelines.some(line => /repository/.test(line)));
  assert.ok(questionPromptGuidelines.some(line => /unanswered note/.test(line)));
  assert.ok(questionPromptGuidelines.some(line => /Treat each note/.test(line)));
  assert.ok(questionPromptGuidelines.some(line => /yes\/no.*kind='single'.*Yes and No/.test(line)));
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
      { id: "details", prompt: "Explain", kind: "text" as const },
    ],
  };
  const call = tool.renderCall?.(args, renderTheme, {} as never);
  assert.match(call?.render(120).join("\n") ?? "", /Q1: Choose/);
  assert.match(call?.render(120).join("\n") ?? "", /Q2: Explain/);

  const result = {
    content: [{ type: "text", text: "" }],
    details: {
      status: "submitted",
      responses: {
        choice: { kind: "single", value: "b", note: "because" },
        details: { kind: "unanswered", note: "need another path" },
      },
    },
  } as never;
  const collapsed = tool.renderResult?.(result, { expanded: false } as never, renderTheme, { args } as never);
  const collapsedText = collapsed?.render(160).join("\n") ?? "";
  assert.match(collapsedText, /1 answered, 1 unanswered with note, 0 untouched/);
  assert.match(collapsedText, /Choose — B — note: because/);
  assert.match(collapsedText, /Explain — Unanswered — note: need another path/);
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
