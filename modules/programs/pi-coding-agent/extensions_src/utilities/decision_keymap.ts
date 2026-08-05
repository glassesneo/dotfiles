import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { matchesKey, type KeyId } from "@earendil-works/pi-tui";
import { canonicalKeyId, isValidKeyId } from "./private_key_id.ts";
import { keyLabel, loadFeatureKeybindings } from "./extension_keybindings.ts";

export const questionContexts = ["question.single", "question.multi", "question.text", "question.note", "question.write-in", "question.review", "question.common"] as const;
export type QuestionContext = (typeof questionContexts)[number];
export const uiActions = ["accept", "newline", "next-question", "previous-question", "back", "cancel", "clear", "move-up", "move-down", "toggle", "select-and-note", "write-in"] as const;
export type UiAction = (typeof uiActions)[number];
export type QuestionKeymapConfig = Partial<Record<QuestionContext, Partial<Record<UiAction, string[]>>>>;
export type ResolvedQuestionKeymap = Record<QuestionContext, Partial<Record<UiAction, KeyId[]>>>;

const DEFAULT_CONFIG: QuestionKeymapConfig = {
    "question.common": { "next-question": ["ctrl+f"], "previous-question": ["ctrl+b"], back: ["escape"], cancel: ["ctrl+c"] },
    "question.single": { accept: ["enter"], "move-up": ["ctrl+p"], "move-down": ["ctrl+n"], toggle: ["space"], "select-and-note": ["e"], "write-in": ["shift+enter"] },
    "question.multi": { accept: ["enter"], "move-up": ["ctrl+p"], "move-down": ["ctrl+n"], toggle: ["space"], "select-and-note": ["e"], "write-in": ["shift+enter"] },
    "question.review": { accept: ["enter"], "move-up": ["ctrl+p"], "move-down": ["ctrl+n"] },
    "question.text": { accept: ["enter"], newline: ["shift+enter"] },
    "question.note": { accept: ["enter"], newline: ["shift+enter"], clear: ["ctrl+c"], cancel: [] },
    "question.write-in": { accept: ["enter"], newline: ["shift+enter"], clear: ["ctrl+c"], cancel: [] },
};

const required: Partial<Record<QuestionContext, UiAction[][]>> = {
    "question.single": [["accept"], ["move-up"], ["move-down"], ["back", "cancel"]],
    "question.multi": [["accept"], ["move-up"], ["move-down"], ["back", "cancel"]],
    "question.text": [["accept"], ["newline"], ["back", "cancel"]],
    "question.note": [["accept"], ["newline"], ["back"], ["clear"]],
    "question.write-in": [["accept"], ["newline"], ["back"], ["clear"]],
    "question.review": [["accept"], ["move-up"], ["move-down"], ["next-question", "previous-question"], ["back", "cancel"]],
};

export function validateQuestionKeymapConfig(config: unknown, path = "extension-keybindings.json"): QuestionKeymapConfig {
    if (config === null || typeof config !== "object" || Array.isArray(config)) throw new Error(`${path}: expected an object`);
    for (const [context, actions] of Object.entries(config)) {
        if (!(questionContexts as readonly string[]).includes(context)) throw new Error(`${path}: unknown context ${context}`);
        if (actions === null || typeof actions !== "object" || Array.isArray(actions)) throw new Error(`${path}: ${context} must be an object`);
        for (const [action, keys] of Object.entries(actions)) {
            if (!(uiActions as readonly string[]).includes(action)) throw new Error(`${path}: ${context}: unknown action ${action}`);
            if (!Array.isArray(keys) || keys.some(key => typeof key !== "string")) throw new Error(`${path}: ${context}.${action} must be an array of keys`);
            for (const key of keys as string[]) if (!isValidKeyId(key)) throw new Error(`${path}: ${context}.${action}: invalid key ${JSON.stringify(key)}`);
        }
    }
    return config as QuestionKeymapConfig;
}

export function loadQuestionKeymapConfig(agentDir?: string): { config: QuestionKeymapConfig; path: string } {
    const loaded = loadFeatureKeybindings("question", agentDir);
    const get = (name: string): KeyId[] => loaded.actions[name] ?? [];
    const choice = { accept: get("choice.accept"), "move-up": get("choice.move-up"), "move-down": get("choice.move-down"), toggle: get("choice.toggle"), "select-and-note": get("choice.select-and-note"), "write-in": get("choice.write-in") };
    return { path: loaded.path, config: {
        "question.common": { "next-question": get("common.next-question"), "previous-question": get("common.previous-question"), back: get("common.back"), cancel: get("common.cancel") },
        "question.single": choice, "question.multi": choice,
        "question.review": { accept: get("review.accept"), "move-up": get("review.move-up"), "move-down": get("review.move-down") },
        "question.text": { accept: get("text.accept"), newline: get("text.newline") },
        "question.note": { accept: get("text.accept"), newline: get("text.newline"), clear: get("editor.clear"), cancel: [] },
        "question.write-in": { accept: get("text.accept"), newline: get("text.newline"), clear: get("editor.clear"), cancel: [] },
    } };
}

export function resolveQuestionKeymap(_manager: Pick<KeybindingsManager, "getKeys">, config: QuestionKeymapConfig = DEFAULT_CONFIG, path = "extension-keybindings.json"): ResolvedQuestionKeymap {
    validateQuestionKeymapConfig(config, path);
    const result = Object.fromEntries(questionContexts.map(context => [context, { ...DEFAULT_CONFIG[context], ...config[context] }])) as ResolvedQuestionKeymap;
    for (const context of questionContexts.filter(value => value !== "question.common")) {
        const effective = { ...result["question.common"], ...result[context] };
        const byKey = new Map<string, UiAction[]>();
        for (const [action, keys] of Object.entries(effective) as Array<[UiAction, KeyId[]]>) for (const key of keys) {
            const canonical = canonicalKeyId(key); byKey.set(canonical, [...(byKey.get(canonical) ?? []), action]);
        }
        for (const [key, actions] of byKey) if (actions.length > 1) throw new Error(`${path}: ${context}: key ${key} conflicts between actions ${actions.join(", ")}`);
        for (const alternatives of required[context] ?? []) if (!alternatives.some(action => (effective[action]?.length ?? 0) > 0)) throw new Error(`${path}: ${context}: required action missing (${alternatives.join(" or ")})`);
    }
    return result;
}

function effectiveMap(keymap: ResolvedQuestionKeymap, context: QuestionContext): Partial<Record<UiAction, KeyId[]>> { return context === "question.common" ? keymap[context] : { ...keymap["question.common"], ...keymap[context] }; }
export function resolveUiAction(data: string, context: QuestionContext, keymap: ResolvedQuestionKeymap): UiAction | undefined {
    const matches: Array<{ action: UiAction; specificity: number }> = [];
    for (const [action, keys] of Object.entries(effectiveMap(keymap, context)) as Array<[UiAction, KeyId[]]>) for (const key of keys) if (matchesKey(data, key)) matches.push({ action, specificity: key.split("+").length - 1 });
    matches.sort((left, right) => right.specificity - left.specificity); return matches[0]?.action;
}
const actionLabels: Record<UiAction, string> = { accept: "confirm", newline: "newline", "next-question": "next", "previous-question": "previous", back: "back", cancel: "cancel", clear: "clear", "move-up": "up", "move-down": "down", toggle: "toggle", "select-and-note": "select and note", "write-in": "write response" };
export function detailedQuestionHelp(context: QuestionContext, keymap: ResolvedQuestionKeymap): Array<{ action: UiAction; keys: string[]; label: string }> { return (Object.entries(effectiveMap(keymap, context)) as Array<[UiAction, KeyId[]]>).filter(([, keys]) => keys.length > 0).map(([action, keys]) => ({ action, keys: [...keys], label: actionLabels[action] })); }
export function questionHelp(context: QuestionContext, keymap: ResolvedQuestionKeymap, excluded?: ReadonlySet<UiAction>): string { return detailedQuestionHelp(context, keymap).filter(item => !excluded?.has(item.action)).map(item => `${keyLabel(item.keys[0]!)} ${item.label}`).join(" • "); }
