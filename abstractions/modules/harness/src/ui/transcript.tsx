import type { ScrollBoxRenderable } from "@opentui/core";
import { Index, Match, Switch } from "solid-js";
import type { TranscriptEntry } from "../core/transcript";

const noticeColor = { info: "#89b4fa", warning: "#f9e2af", error: "#f38ba8" } as const;

function ofKind<K extends TranscriptEntry["kind"]>(entry: TranscriptEntry, kind: K) {
  return entry.kind === kind ? (entry as Extract<TranscriptEntry, { kind: K }>) : undefined;
}

/** The agent's history. Stays pinned to the newest entry unless scrolled up. */
export function TranscriptView(props: {
  entries: readonly TranscriptEntry[];
  ref: (scrollbox: ScrollBoxRenderable) => void;
}) {
  return (
    <scrollbox ref={props.ref} flexGrow={1} stickyScroll stickyStart="bottom" paddingX={1}>
      {/* Rows are kept by position, so a streamed reply updates its row in place. */}
      <Index each={props.entries}>
        {(entry) => (
          <box marginBottom={entry().kind === "tool" ? 0 : 1}>
            <Switch>
              <Match when={ofKind(entry(), "user")}>
                {(user) => <text fg="#a6e3a1">{`> ${user().text}`}</text>}
              </Match>
              <Match when={ofKind(entry(), "assistant")}>
                {(assistant) => <text>{assistant().text}</text>}
              </Match>
              <Match when={ofKind(entry(), "tool")}>
                {(tool) => (
                  <text fg="#6c7086">{`· ${tool().name}${tool().status === "error" ? " (failed)" : ""}`}</text>
                )}
              </Match>
              <Match when={ofKind(entry(), "notice")}>
                {(notice) => <text fg={noticeColor[notice().level]}>{notice().text}</text>}
              </Match>
            </Switch>
          </box>
        )}
      </Index>
    </scrollbox>
  );
}
