import type { ContextUsage } from "@earendil-works/pi-coding-agent";

export const commandPaletteActionIds = ["model", "thinking", "tools", "tool-output", "session-info", "copy-last-response", "theme"] as const;
export type CommandPaletteActionId = (typeof commandPaletteActionIds)[number];
export type PaletteUiKind = "select" | "settings" | "toggle" | "information" | "immediate";

export interface PaletteAction {
    id: CommandPaletteActionId;
    label: string;
    description: string;
    keywords: readonly string[];
    uiKind: PaletteUiKind;
    currentValue?: string;
    disabledReason?: string;
}

export interface PaletteListItem<T = string> {
    value: T;
    label: string;
    description?: string;
    keywords?: readonly string[];
    state?: string;
    disabledReason?: string;
}

export function filterPaletteItems<T>(items: readonly PaletteListItem<T>[], query: string): PaletteListItem<T>[] {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [...items];
    return items.filter(item => {
        const text = [item.label, item.description, item.state, item.disabledReason, ...(item.keywords ?? [])].filter(Boolean).join(" ").toLocaleLowerCase();
        return terms.every(term => text.includes(term));
    });
}

export interface SessionEntryLike {
    type: string;
    message?: { role?: string; content?: unknown };
}

export function extractLastAssistantText(entries: readonly SessionEntryLike[]): string | undefined {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
        const text = entry.message.content
            .filter((block): block is { type: "text"; text: string } => block !== null && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
            .map(block => block.text).join("\n");
        if (text.length > 0) return text;
    }
    return undefined;
}

export interface SessionSummary {
    entryCount: number;
    userCount: number;
    assistantCount: number;
    toolCallCount: number;
    toolResultCount: number;
}

export function summarizeSession(entries: readonly SessionEntryLike[]): SessionSummary {
    const result: SessionSummary = { entryCount: entries.length, userCount: 0, assistantCount: 0, toolCallCount: 0, toolResultCount: 0 };
    for (const entry of entries) {
        if (entry.type !== "message") continue;
        if (entry.message?.role === "user") result.userCount += 1;
        if (entry.message?.role === "assistant") {
            result.assistantCount += 1;
            if (Array.isArray(entry.message.content)) result.toolCallCount += entry.message.content.filter(block => block !== null && typeof block === "object" && (block as { type?: unknown }).type === "toolCall").length;
        }
        if (entry.message?.role === "toolResult") result.toolResultCount += 1;
    }
    return result;
}

export function formatContextUsage(usage: ContextUsage | undefined): string {
    if (!usage) return "unknown";
    const tokens = usage.tokens === null ? "unknown" : usage.tokens.toLocaleString();
    const percent = usage.percent === null ? "unknown" : `${usage.percent.toFixed(1)}%`;
    return `${tokens} / ${usage.contextWindow.toLocaleString()} tokens (${percent})`;
}
