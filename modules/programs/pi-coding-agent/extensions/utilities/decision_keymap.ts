import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { matchesKey, type KeyId } from "@earendil-works/pi-tui";

export const questionContexts = [
    "question.single", "question.multi", "question.confirm", "question.text",
    "question.note", "question.review", "question.common",
] as const;
export type QuestionContext = (typeof questionContexts)[number];

export const uiActions = [
    "accept", "newline", "next-question", "previous-question", "back", "cancel",
    "move-up", "move-down", "toggle", "edit-note", "confirm-yes", "confirm-no",
] as const;
export type UiAction = (typeof uiActions)[number];
export type QuestionKeymapConfig = Partial<Record<QuestionContext, Partial<Record<UiAction, string[]>>>>;
export type ResolvedQuestionKeymap = Record<QuestionContext, Partial<Record<UiAction, KeyId[]>>>;

const DEFAULT_OVERRIDES: QuestionKeymapConfig = {
    "question.common": {
        "next-question": ["tab"], "previous-question": ["shift+tab"],
        back: ["escape"], cancel: ["ctrl+c"],
    },
    "question.single": { "move-up": ["up", "k"], "move-down": ["down", "j"], toggle: ["space"], "edit-note": ["e"] },
    "question.multi": { "move-up": ["up", "k"], "move-down": ["down", "j"], toggle: ["space"], "edit-note": ["e"] },
    "question.confirm": { "move-up": ["up", "k"], "move-down": ["down", "j"], "edit-note": ["e"], "confirm-yes": ["y"], "confirm-no": ["n"] },
    "question.review": { "move-up": ["up", "k"], "move-down": ["down", "j"] },
};

const inherited: Partial<Record<QuestionContext, Partial<Record<UiAction, string>>>> = {
    "question.single": { accept: "tui.select.confirm", "move-up": "tui.select.up", "move-down": "tui.select.down" },
    "question.multi": { accept: "tui.select.confirm", "move-up": "tui.select.up", "move-down": "tui.select.down" },
    "question.confirm": { accept: "tui.select.confirm", "move-up": "tui.select.up", "move-down": "tui.select.down" },
    "question.text": { accept: "tui.input.submit", newline: "tui.input.newLine" },
    "question.note": { accept: "tui.input.submit", newline: "tui.input.newLine" },
    "question.review": { accept: "tui.select.confirm", "move-up": "tui.select.up", "move-down": "tui.select.down" },
};

const required: Partial<Record<QuestionContext, UiAction[][]>> = {
    "question.single": [["accept"], ["move-up", "move-down"], ["back", "cancel"]],
    "question.multi": [["accept"], ["move-up", "move-down"], ["back", "cancel"]],
    "question.confirm": [["accept", "confirm-yes", "confirm-no"], ["move-up", "move-down"], ["back", "cancel"]],
    "question.text": [["accept"], ["newline"], ["back", "cancel"]],
    "question.note": [["accept"], ["newline"], ["back", "cancel"]],
    "question.review": [["accept"], ["move-up", "move-down", "next-question", "previous-question"], ["back", "cancel"]],
};

function validKey(key: string): boolean {
    const parts = key.split("+");
    if (parts.some(part => part.length === 0)) return false;
    const base = parts.at(-1)!;
    const modifiers = parts.slice(0, -1);
    if (new Set(modifiers).size !== modifiers.length || modifiers.some(mod => !["ctrl", "shift", "alt"].includes(mod))) return false;
    return /^[a-z0-9]$/.test(base) || /^(escape|esc|enter|return|tab|space|backspace|delete|insert|clear|home|end|pageUp|pageDown|up|down|left|right|f(?:[1-9]|1[0-2])|[`\-=\[\]\\;',./!@#$%^&*()_+|~{}:<>?])$/.test(base);
}

export function validateQuestionKeymapConfig(config: unknown, path = "question-keybindings.json"): QuestionKeymapConfig {
    if (config === null || typeof config !== "object" || Array.isArray(config)) throw new Error(`${path}: expected an object`);
    for (const [context, actions] of Object.entries(config)) {
        if (!(questionContexts as readonly string[]).includes(context)) throw new Error(`${path}: unknown context ${context}`);
        if (actions === null || typeof actions !== "object" || Array.isArray(actions)) throw new Error(`${path}: ${context} must be an object`);
        for (const [action, keys] of Object.entries(actions)) {
            if (!(uiActions as readonly string[]).includes(action)) throw new Error(`${path}: ${context}: unknown action ${action}`);
            if (!Array.isArray(keys) || keys.some(key => typeof key !== "string")) throw new Error(`${path}: ${context}.${action} must be an array of keys`);
            for (const key of keys as string[]) if (!validKey(key)) throw new Error(`${path}: ${context}.${action}: invalid key ${JSON.stringify(key)}`);
        }
    }
    return config as QuestionKeymapConfig;
}

export function loadQuestionKeymapConfig(agentDir = getAgentDir()): { config: QuestionKeymapConfig; path: string } {
    const path = join(agentDir, "question-keybindings.json");
    if (!existsSync(path)) return { config: DEFAULT_OVERRIDES, path: "<bundled question-keybindings.json>" };
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(path, "utf8")); }
    catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
    return { config: validateQuestionKeymapConfig(parsed, path), path };
}

export function resolveQuestionKeymap(manager: Pick<KeybindingsManager, "getKeys">, config: QuestionKeymapConfig = DEFAULT_OVERRIDES, path = "question-keybindings.json"): ResolvedQuestionKeymap {
    validateQuestionKeymapConfig(config, path);
    const result = Object.fromEntries(questionContexts.map(context => [context, {}])) as ResolvedQuestionKeymap;
    for (const context of questionContexts) {
        const map = result[context];
        for (const [action, binding] of Object.entries(inherited[context] ?? {}) as Array<[UiAction, string]>) {
            map[action] = [...manager.getKeys(binding as never)];
        }
        for (const [action, keys] of Object.entries(DEFAULT_OVERRIDES[context] ?? {}) as Array<[UiAction, string[]]>) map[action] = keys as KeyId[];
        for (const [action, keys] of Object.entries(config[context] ?? {}) as Array<[UiAction, string[]]>) map[action] = keys as KeyId[];
    }
    for (const context of questionContexts.filter(value => value !== "question.common")) {
        const effective = { ...result["question.common"], ...result[context] };
        const byKey = new Map<string, UiAction[]>();
        for (const [action, keys] of Object.entries(effective) as Array<[UiAction, KeyId[]]>) {
            for (const key of keys) byKey.set(key, [...(byKey.get(key) ?? []), action]);
        }
        for (const [key, actions] of byKey) if (actions.length > 1) {
            throw new Error(`${path}: ${context}: key ${key} conflicts between actions ${actions.join(", ")}`);
        }
        for (const alternatives of required[context] ?? []) if (!alternatives.some(action => (effective[action]?.length ?? 0) > 0)) {
            throw new Error(`${path}: ${context}: required action missing (${alternatives.join(" or ")})`);
        }
    }
    return result;
}

function effectiveMap(keymap: ResolvedQuestionKeymap, context: QuestionContext): Partial<Record<UiAction, KeyId[]>> {
    return context === "question.common" ? keymap[context] : { ...keymap["question.common"], ...keymap[context] };
}

export function resolveUiAction(data: string, context: QuestionContext, keymap: ResolvedQuestionKeymap): UiAction | undefined {
    const matches: Array<{ action: UiAction; specificity: number }> = [];
    for (const [action, keys] of Object.entries(effectiveMap(keymap, context)) as Array<[UiAction, KeyId[]]>) {
        for (const key of keys) if (matchesKey(data, key)) {
            matches.push({ action, specificity: key.split("+").length - 1 });
        }
    }
    // Some terminals encode Ctrl-J as LF, which also matches Enter. Prefer the
    // explicitly modified binding so newline remains distinguishable from submit.
    matches.sort((left, right) => right.specificity - left.specificity);
    return matches[0]?.action;
}

const actionLabels: Record<UiAction, string> = {
    accept: "confirm", newline: "newline", "next-question": "next", "previous-question": "previous",
    back: "back", cancel: "cancel", "move-up": "up", "move-down": "down", toggle: "toggle",
    "edit-note": "edit note", "confirm-yes": "Yes", "confirm-no": "No",
};
export function detailedQuestionHelp(context: QuestionContext, keymap: ResolvedQuestionKeymap): Array<{ action: UiAction; keys: string[]; label: string }> {
    return (Object.entries(effectiveMap(keymap, context)) as Array<[UiAction, KeyId[]]>).filter(([, keys]) => keys.length > 0).map(([action, keys]) => ({ action, keys: [...keys], label: actionLabels[action] }));
}
export function questionHelp(context: QuestionContext, keymap: ResolvedQuestionKeymap): string {
    return detailedQuestionHelp(context, keymap).map(item => `${item.keys[0]} ${item.label}`).join(" • ");
}

// Generic names for shared decision consumers; question-prefixed names remain
// compatibility aliases for the deployed keybinding contexts and JSON format.
export const resolveDecisionKeymap = resolveQuestionKeymap;
export const decisionHelp = questionHelp;
export type DecisionContext = QuestionContext;
export type ResolvedDecisionKeymap = ResolvedQuestionKeymap;
