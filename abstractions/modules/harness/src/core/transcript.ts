import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { contentText } from "@earendil-works/pi-ai";

/**
 * What the transcript shows, derived from session events. Renderers switch on
 * `kind`, so richer views (tool output, thinking) extend this union.
 */
export type TranscriptEntry =
  | { kind: "user"; id: string; text: string }
  | AssistantEntry
  | { kind: "tool"; id: string; name: string; status: "running" | "done" | "error" }
  | { kind: "notice"; id: string; level: NoticeLevel; text: string };

type AssistantEntry = { kind: "assistant"; id: string; text: string; streaming: boolean };

export type NoticeLevel = "info" | "warning" | "error";

let nextId = 0;
const newId = () => `entry-${nextId++}`;

export function notice(level: NoticeLevel, text: string): TranscriptEntry {
  return { kind: "notice", id: newId(), level, text };
}

/**
 * Set the text of the reply being streamed. The entry is created with its first
 * text, so a reply that only calls tools leaves no entry.
 */
function updateAssistant(
  entries: readonly TranscriptEntry[],
  text: string,
  streaming: boolean,
): readonly TranscriptEntry[] {
  const index = entries.findLastIndex((entry) => entry.kind === "assistant" && entry.streaming);
  if (index === -1) {
    return text === "" ? entries : [...entries, { kind: "assistant", id: newId(), text, streaming }];
  }
  const next = [...entries];
  next[index] = { ...(entries[index] as AssistantEntry), text, streaming };
  return next;
}

export function reduceTranscript(
  entries: readonly TranscriptEntry[],
  event: AgentSessionEvent,
): readonly TranscriptEntry[] {
  switch (event.type) {
    case "message_start":
      return event.message.role === "user"
        ? [...entries, { kind: "user", id: newId(), text: contentText(event.message.content, "") }]
        : entries;
    case "message_update":
    case "message_end": {
      const { message } = event;
      if (message.role !== "assistant") {
        return entries;
      }
      const next = updateAssistant(
        entries,
        contentText(message.content, ""),
        event.type === "message_update",
      );
      return event.type === "message_end" && message.stopReason === "error" && message.errorMessage
        ? [...next, notice("error", message.errorMessage)]
        : next;
    }
    case "tool_execution_start":
      return [
        ...entries,
        { kind: "tool", id: event.toolCallId, name: event.toolName, status: "running" },
      ];
    case "tool_execution_end":
      return entries.map((entry) =>
        entry.kind === "tool" && entry.id === event.toolCallId
          ? { ...entry, status: event.isError ? "error" : "done" }
          : entry,
      );
    default:
      return entries;
  }
}
