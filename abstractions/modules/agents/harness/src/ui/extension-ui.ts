import type { ExtensionUIContext, ExtensionUIDialogOptions, Theme } from "@earendil-works/pi-coding-agent";
import type { JSX } from "@opentui/solid";
import type { NoticeLevel } from "../core/session-entries";
import type { ChoiceValue } from "./stage";
import type { StageContentType } from "./controllers";
import type { HarnessUIInstance } from "./harness-ui";

export function createExtensionUI(options: {
  ui: HarnessUIInstance<JSX.Element>;
  choiceType: StageContentType<ChoiceValue, JSX.Element>;
  confirmType: StageContentType<ChoiceValue, JSX.Element>;
  notify(level: NoticeLevel, text: string): void;
}) {
  const editor = options.ui.controllers.editor;
  let queue = Promise.resolve();
  const pending = new Set<AbortController>();

  // Pi requests share a queue even when they use different screen boundaries.
  function open<T>(opts: ExtensionUIDialogOptions | undefined, fallback: T, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const abort = new AbortController();
    pending.add(abort);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let resolve!: (value: T) => void;
    const result = new Promise<T>((done) => { resolve = done; });
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", onAbort);
      abort.signal.removeEventListener("abort", onAbort);
      pending.delete(abort);
      resolve(value);
    };
    const onAbort = () => { abort.abort(); finish(fallback); };
    abort.signal.addEventListener("abort", onAbort, { once: true });
    if (opts?.signal?.aborted) onAbort();
    else opts?.signal?.addEventListener("abort", onAbort, { once: true });
    queue = queue.then(async () => {
      if (settled) return;
      if (opts?.timeout) timer = setTimeout(onAbort, opts.timeout);
      try { finish(await work(abort.signal)); }
      catch (error) { options.notify("error", String(error)); finish(fallback); }
    });
    return result;
  }

  const choose = async (type: StageContentType<ChoiceValue, JSX.Element>, title: string, choices: string[], message: string | undefined, signal: AbortSignal) => {
    const handle = options.ui.stage.show({ requester: "pi", type, value: { title, message, choices, cursor: 0 }, preferredHeight: choices.length + (message ? 2 : 1), signal });
    const result = await handle.closed;
    return result.status === "closed" ? result.value.result : undefined;
  };
  const requestDraft = async (kind: string, title: string, initialText: string | undefined, signal: AbortSignal) => {
    const result = await options.ui.editor.openDraft({
      destination: `pi:${kind}:${title}`, label: title,
      requester: options.ui.controllers.regions.current(), initialText, signal,
    });
    return result.status === "submitted" ? result.text : undefined;
  };

  const context: ExtensionUIContext = {
    select: (title, choices, opts) => open(opts, undefined, (signal) => choose(options.choiceType, title, choices, undefined, signal)),
    confirm: (title, message, opts) => open(opts, false, async (signal) => (await choose(options.confirmType, title, ["Yes", "No"], message, signal)) === "Yes"),
    input: (title, placeholder, opts) => open(opts, undefined, (signal) => requestDraft("input", placeholder ? `${title} (${placeholder})` : title, undefined, signal)),
    editor: (title, prefill) => open(undefined, undefined, (signal) => requestDraft("editor", title, prefill, signal)),
    notify: (message, type) => options.notify(type ?? "info", message),
    setStatus: () => {}, setWidget: () => {}, setTitle: () => {},
    onTerminalInput: () => () => {},
    setWorkingMessage: () => {}, setWorkingVisible: () => {}, setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {}, setFooter: () => {}, setHeader: () => {},
    custom: async () => undefined as never,
    pasteToEditor: (text) => {
      const snapshot = editor.snapshot();
      editor.setText(snapshot.text.slice(0, snapshot.cursor) + text + snapshot.text.slice(snapshot.cursor));
      editor.setCursor(snapshot.cursor + text.length);
    },
    setEditorText: (text) => editor.setText(text),
    getEditorText: () => editor.text(),
    addAutocompleteProvider: () => {}, setEditorComponent: () => {}, getEditorComponent: () => undefined,
    // Pi does not export the theme accessor; terminal-independent extensions still read it.
    get theme(): Theme {
      return (globalThis as Record<symbol, Theme>)[Symbol.for("@earendil-works/pi-coding-agent:theme")] as Theme;
    },
    getAllThemes: () => [], getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Themes are not supported by harness" }),
    getToolsExpanded: () => false, setToolsExpanded: () => {},
  };
  return { context, dispose: () => { for (const abort of pending) abort.abort(); } };
}
