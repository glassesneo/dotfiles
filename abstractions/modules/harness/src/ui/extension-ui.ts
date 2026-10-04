import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { createSignal } from "solid-js";
import type { NoticeLevel } from "../core/transcript";

type DialogRequest =
  | { kind: "select"; title: string; options: string[]; resolve: (value: string | undefined) => void }
  | { kind: "confirm"; title: string; message: string; resolve: (value: boolean) => void }
  | { kind: "input"; title: string; placeholder?: string; resolve: (value: string | undefined) => void };

/** A dialog on screen; `cancel` resolves it with the request's default value. */
export type Dialog = DialogRequest & { cancel: () => void };

/**
 * The terminal-independent part of pi's extension UI, the same surface pi's
 * RPC mode offers. Methods that hand pi-tui components to the host are
 * accepted and ignored.
 */
export function createExtensionUI(options: { notify: (level: NoticeLevel, text: string) => void }) {
  const [dialog, setDialog] = createSignal<Dialog | undefined>();

  // Dialogs are shown one at a time; a later request waits for earlier ones.
  let queue = Promise.resolve();

  function open<T>(
    opts: ExtensionUIDialogOptions | undefined,
    fallback: T,
    make: (resolve: (value: T) => void) => DialogRequest,
  ): Promise<T> {
    const result = queue.then(
      () =>
        new Promise<T>((resolve) => {
          if (opts?.signal?.aborted) {
            resolve(fallback);
            return;
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          const finish = (value: T) => {
            clearTimeout(timer);
            opts?.signal?.removeEventListener("abort", onAbort);
            setDialog(undefined);
            resolve(value);
          };
          const onAbort = () => finish(fallback);
          opts?.signal?.addEventListener("abort", onAbort, { once: true });
          if (opts?.timeout) {
            timer = setTimeout(() => finish(fallback), opts.timeout);
          }
          setDialog({ ...make(finish), cancel: onAbort });
        }),
    );
    queue = result.then(() => undefined);
    return result;
  }

  const context: ExtensionUIContext = {
    select: (title, choices, opts) =>
      open<string | undefined>(opts, undefined, (resolve) => ({
        kind: "select",
        title,
        options: choices,
        resolve,
      })),
    confirm: (title, message, opts) =>
      open(opts, false, (resolve) => ({ kind: "confirm", title, message, resolve })),
    input: (title, placeholder, opts) =>
      open<string | undefined>(opts, undefined, (resolve) => ({
        kind: "input",
        title,
        placeholder,
        resolve,
      })),
    // No multi-line editor yet; the prefill is only shown as a placeholder.
    editor: (title, prefill) => context.input(title, prefill),
    notify: (message, type) => options.notify(type ?? "info", message),
    setStatus: () => {},
    setWidget: () => {},
    setTitle: () => {},
    onTerminalInput: () => () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setFooter: () => {},
    setHeader: () => {},
    custom: async () => undefined as never,
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    // Extensions read the theme even outside pi-tui, for example to style
    // notification text. pi keeps the theme set by initTheme() under this
    // global key and does not export its accessor.
    get theme(): Theme {
      return (globalThis as Record<symbol, Theme>)[
        Symbol.for("@earendil-works/pi-coding-agent:theme")
      ] as Theme;
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Themes are not supported by harness" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };

  return { context, dialog };
}
