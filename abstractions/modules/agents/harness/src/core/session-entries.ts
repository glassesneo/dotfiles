import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { contentText } from "@earendil-works/pi-ai";

/**
 * What the timeline shows, derived from session events. Each entry carries a
 * monotonic `version` so the projection can replace an item in place without
 * changing its identity.
 */
export type SessionEntry = UserEntry | AssistantEntry | ToolEntry | NoticeEntry;

export interface UserEntry {
  kind: "user";
  id: string;
  version: number;
  text: string;
}

export interface AssistantEntry {
  kind: "assistant";
  id: string;
  version: number;
  text: string;
  streaming: boolean;
}

export type ToolStatus = "running" | "done" | "error";

export interface ToolEntry {
  kind: "tool";
  id: string;
  version: number;
  name: string;
  status: ToolStatus;
  /** The raw result text, kept apart from the short summary the row shows. */
  sourceText: string;
}

export interface NoticeEntry {
  kind: "notice";
  id: string;
  version: number;
  level: NoticeLevel;
  text: string;
}

export type NoticeLevel = "info" | "warning" | "error";

let nextId = 0;
const newId = () => `entry-${nextId++}`;

export function notice(level: NoticeLevel, text: string): NoticeEntry {
  return { kind: "notice", id: newId(), version: 0, level, text };
}

/**
 * Set the text of the reply being streamed. The entry is created with its first
 * text, so a reply that only calls tools leaves no entry. The id is kept for the
 * whole message; `version` grows whenever what the message shows changes.
 */
function updateAssistant(
  entries: readonly SessionEntry[],
  text: string,
  streaming: boolean,
): readonly SessionEntry[] {
  const index = entries.findLastIndex((entry) => entry.kind === "assistant" && entry.streaming);
  if (index === -1) {
    return text === ""
      ? entries
      : [...entries, { kind: "assistant", id: newId(), version: 0, text, streaming }];
  }
  const previous = entries[index] as AssistantEntry;
  const changed = previous.text !== text || previous.streaming !== streaming;
  const next = [...entries];
  next[index] = {
    ...previous,
    text,
    streaming,
    version: changed ? previous.version + 1 : previous.version,
  };
  return next;
}

/**
 * Session entries for an existing history, for when the session or branch is
 * replaced. They match what live events would have produced for the same run.
 */
export function sessionEntriesFromMessages(
  messages: readonly AgentSession["messages"][number][],
): readonly SessionEntry[] {
  return messages.reduce<readonly SessionEntry[]>((entries, message) => {
    switch (message.role) {
      case "user":
        return [
          ...entries,
          { kind: "user", id: newId(), version: 0, text: contentText(message.content, "") },
        ];
      case "assistant": {
        const next = updateAssistant(entries, contentText(message.content, ""), false);
        const error: SessionEntry[] =
          message.stopReason === "error" && message.errorMessage
            ? [notice("error", message.errorMessage)]
            : [];
        const tools = message.content.flatMap((block): SessionEntry[] =>
          block.type === "toolCall"
            ? [
                {
                  kind: "tool",
                  id: block.id,
                  version: 0,
                  name: block.name,
                  status: "running",
                  sourceText: "",
                },
              ]
            : [],
        );
        return [...next, ...error, ...tools];
      }
      case "toolResult":
        return finishTool(
          entries,
          message.toolCallId,
          message.isError,
          contentText(message.content, ""),
        );
      default:
        return entries;
    }
  }, []);
}

function finishTool(
  entries: readonly SessionEntry[],
  toolCallId: string,
  isError: boolean,
  sourceText: string,
): readonly SessionEntry[] {
  return entries.map((entry) =>
    entry.kind === "tool" && entry.id === toolCallId
      ? {
          ...entry,
          status: isError ? "error" : "done",
          sourceText,
          version: entry.version + 1,
        }
      : entry,
  );
}

/** Tool results reach the session as a message content, a string, or a wrapper. */
function resultText(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (Array.isArray(result)) {
    return contentText(result as Parameters<typeof contentText>[0], "");
  }
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content: unknown }).content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return contentText(content as Parameters<typeof contentText>[0], "");
    }
  }
  return "";
}

export function reduceSessionEntries(
  entries: readonly SessionEntry[],
  event: AgentSessionEvent,
): readonly SessionEntry[] {
  switch (event.type) {
    case "message_start":
      return event.message.role === "user"
        ? [
            ...entries,
            {
              kind: "user",
              id: newId(),
              version: 0,
              text: contentText(event.message.content, ""),
            },
          ]
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
        {
          kind: "tool",
          id: event.toolCallId,
          version: 0,
          name: event.toolName,
          status: "running",
          sourceText: "",
        },
      ];
    case "tool_execution_end":
      return finishTool(entries, event.toolCallId, event.isError, resultText(event.result));
    default:
      return entries;
  }
}

// ---------------------------------------------------------------------------
// Fenced block splitting
// ---------------------------------------------------------------------------

export type FencedBlock = TextRun | FencedCode;

export interface TextRun {
  type: "text";
  text: string;
}

export interface FencedCode {
  type: "code";
  language: string;
  body: string;
  /** The whole block including its opening and closing fence lines. */
  sourceText: string;
}

const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

/**
 * Split text into plain runs and fenced code blocks. Only a line-start triple
 * backtick or tilde starts a block; this is not a CommonMark parser, so fences
 * inside a block are closed only by a matching fence of the same character.
 */
export function splitFencedBlocks(text: string): FencedBlock[] {
  const lines = text.split("\n");
  const blocks: FencedBlock[] = [];
  let pending: string[] = [];
  const flushText = () => {
    const run = pending.join("\n");
    pending = [];
    if (run.length > 0) {
      blocks.push({ type: "text", text: run });
    }
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const open = FENCE_OPEN.exec(line);
    const marker = open?.[1];
    if (!marker) {
      pending.push(line);
      index += 1;
      continue;
    }
    const character = marker[0];
    let close = index + 1;
    while (close < lines.length) {
      const candidate = FENCE_CLOSE.exec(lines[close] ?? "")?.[1];
      if (candidate && candidate[0] === character && candidate.length >= marker.length) {
        break;
      }
      close += 1;
    }
    if (close >= lines.length) {
      // No closing fence: the opening line is ordinary text.
      pending.push(line);
      index += 1;
      continue;
    }
    flushText();
    blocks.push({
      type: "code",
      language: (open?.[2] ?? "").trim(),
      body: lines.slice(index + 1, close).join("\n"),
      sourceText: lines.slice(index, close + 1).join("\n"),
    });
    index = close + 1;
  }
  flushText();
  return blocks;
}
