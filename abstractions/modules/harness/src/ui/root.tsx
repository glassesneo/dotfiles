import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { createSignal, For, onMount, Show } from "solid-js";
import type { SessionHost } from "../core/session";
import { type NoticeLevel, notice, reduceTranscript, type TranscriptEntry } from "../core/transcript";
import { DialogView } from "./dialog";
import { createExtensionUI } from "./extension-ui";
import { type Action, resolveAction } from "./keymap";
import { PromptView } from "./prompt";
import { TranscriptView } from "./transcript";

/**
 * The screen: transcript above, prompt below, extension dialogs over both.
 * Panels and overlays are added as further children of this column.
 */
export function Root(props: { host: SessionHost; startupNotices: readonly TranscriptEntry[] }) {
  const renderer = useRenderer();
  const [entries, setEntries] = createSignal<readonly TranscriptEntry[]>(props.startupNotices);
  // Messages waiting for the current run; each enters the transcript when it starts.
  const [queued, setQueued] = createSignal<readonly string[]>([]);
  let scrollbox: ScrollBoxRenderable | undefined;

  const addNotice = (level: NoticeLevel, text: string) =>
    setEntries((current) => [...current, notice(level, text)]);

  const ui = createExtensionUI({ notify: addNotice });

  const actions: Record<Action, () => void> = {
    abort: () => {
      const session = props.host.runtime.session;
      if (session.isStreaming) {
        void session.abort();
      }
    },
    quit: () => {
      void props.host.dispose().finally(() => renderer.destroy());
    },
    scrollUp: () => scrollbox?.scrollBy(-1, "viewport"),
    scrollDown: () => scrollbox?.scrollBy(1, "viewport"),
  };

  onMount(() => {
    props.host
      .bind({
        uiContext: ui.context,
        onEvent: (event) => {
          if (event.type === "queue_update") {
            setQueued([...event.steering, ...event.followUp]);
          }
          setEntries((current) => reduceTranscript(current, event));
        },
        onExtensionError: (error) =>
          addNotice("error", `${error.extensionPath} (${error.event}): ${error.error}`),
        onShutdownRequest: actions.quit,
      })
      .catch((error) => addNotice("error", String(error)));
  });

  useKeyboard((key) => {
    const action = resolveAction(key);
    const dialog = ui.dialog();
    if (dialog && action === "abort") {
      dialog.cancel();
      return;
    }
    if (action) {
      key.preventDefault();
      actions[action]();
    }
  });

  /** Resolves once pi accepts or rejects the text, not when the run finishes. */
  const submit = (text: string) =>
    new Promise<boolean>((resolve) => {
      props.host.runtime.session
        .prompt(text, {
          // pi applies streamingBehavior only when a run is in progress.
          streamingBehavior: "followUp",
          // Called once the prompt is accepted (started, queued, or handled),
          // never for a rejected one; pi's RPC mode answers its client from it.
          preflightResult: () => resolve(true),
        })
        .then(
          () => resolve(true),
          (error) => {
            addNotice("error", error instanceof Error ? error.message : String(error));
            resolve(false);
          },
        );
    });

  return (
    <box flexDirection="column" width="100%" height="100%">
      <TranscriptView entries={entries()} ref={(element) => (scrollbox = element)} />
      <For each={queued()}>
        {(text) => <text fg="#6c7086" paddingX={2} flexShrink={0}>{`queued: ${text}`}</text>}
      </For>
      <PromptView focused={!ui.dialog()} onSubmit={submit} />
      <Show when={ui.dialog()}>{(dialog) => <DialogView dialog={dialog()} />}</Show>
    </box>
  );
}
