import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { isValidKeyId } from "./private_key_id.ts";

export interface ExtensionKeybindings {
    schemaVersion: 1;
    features: Record<string, Record<string, KeyId[]>>;
}

const FEATURE_ACTIONS: Record<string, { actions: readonly string[]; required: readonly string[] }> = {
    commandPalette: {
        actions: ["open", "moveUp", "moveDown", "collapse", "expand", "confirm", "cancel", "refresh", "stop"],
        required: ["open", "moveUp", "moveDown", "collapse", "expand", "confirm", "cancel"],
    },
    question: {
        actions: ["common.next-question", "common.previous-question", "common.back", "common.cancel", "choice.accept", "choice.move-up", "choice.move-down", "choice.toggle", "choice.select-and-note", "choice.write-in", "editor.clear", "review.accept", "review.move-up", "review.move-down", "text.accept", "text.newline"],
        required: ["common.next-question", "common.previous-question", "common.back", "common.cancel", "choice.accept", "choice.move-up", "choice.move-down", "choice.write-in", "editor.clear", "review.accept", "review.move-up", "review.move-down", "text.accept", "text.newline"],
    },
    interactionPolicy: { actions: ["clear", "interrupt"], required: ["clear", "interrupt"] },
    meshPalette: {
        actions: ["moveUp", "moveDown", "collapse", "expand", "confirm", "cancel", "refresh", "stop", "preview", "unlink", "toggleTerminal"],
        required: ["moveUp", "moveDown", "collapse", "expand", "confirm", "cancel"],
    },
    historyViewer: { actions: ["exit"], required: ["exit"] },
    meshNavigation: { actions: ["parent"], required: ["parent"] },
    tmuxPreview: { actions: ["openFull", "cancel"], required: ["openFull", "cancel"] },
};

export function validateExtensionKeybindings(value: unknown, path = "extension-keybindings.json"): ExtensionKeybindings {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: expected an object`);
    const root = value as Record<string, unknown>;
    if (root.schemaVersion !== 1) throw new Error(`${path}: unsupported schemaVersion ${String(root.schemaVersion)}`);
    if (root.features === null || typeof root.features !== "object" || Array.isArray(root.features)) throw new Error(`${path}: features must be an object`);
    for (const [feature, actions] of Object.entries(root.features as Record<string, unknown>)) {
        const schema = FEATURE_ACTIONS[feature];
        if (!schema) throw new Error(`${path}: unknown feature ${feature}`);
        if (actions === null || typeof actions !== "object" || Array.isArray(actions)) throw new Error(`${path}: ${feature} must be an object`);
        const actionMap = actions as Record<string, unknown>;
        const actual = Object.keys(actionMap).sort();
        const expected = [...schema.actions].sort();
        const missing = expected.filter(action => !(action in actionMap));
        const unknown = actual.filter(action => !schema.actions.includes(action));
        if (missing.length > 0) throw new Error(`${path}: ${feature}: missing action(s) ${missing.join(", ")}`);
        if (unknown.length > 0) throw new Error(`${path}: ${feature}: unknown action(s) ${unknown.join(", ")}`);
        for (const [action, keys] of Object.entries(actionMap)) {
            if (!Array.isArray(keys) || keys.some(key => typeof key !== "string")) throw new Error(`${path}: ${feature}.${action} must be an array of keys`);
            if (schema.required.includes(action) && keys.length === 0) throw new Error(`${path}: ${feature}.${action} is required`);
            for (const key of keys as string[]) if (!isValidKeyId(key)) throw new Error(`${path}: ${feature}.${action}: invalid key ${JSON.stringify(key)}`);
        }
    }
    return value as ExtensionKeybindings;
}

export function loadExtensionKeybindings(agentDir = getAgentDir()): { config: ExtensionKeybindings; path: string } {
    const path = process.env.PI_EXTENSION_KEYBINDINGS_PATH ?? join(agentDir, "extension-keybindings.json");
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(path, "utf8")); }
    catch (error) { throw new Error(`Cannot read extension keybindings ${path}: ${error instanceof Error ? error.message : String(error)}`); }
    return { config: validateExtensionKeybindings(parsed, path), path };
}

export function loadFeatureKeybindings(feature: string, agentDir = getAgentDir()): { actions: Record<string, KeyId[]>; path: string } {
    const loaded = loadExtensionKeybindings(agentDir);
    const actions = loaded.config.features[feature];
    if (!actions) throw new Error(`${loaded.path}: enabled feature ${feature} is missing`);
    return { actions, path: loaded.path };
}

export function keyLabel(key: string): string {
    return key.split("+").map(part => ({ ctrl: "Ctrl", shift: "Shift", alt: "Alt", escape: "Esc", enter: "Enter", space: "Space" })[part] ?? (part.length === 1 ? part.toUpperCase() : part)).join("+");
}

export function actionHint(actions: Record<string, readonly string[]>, action: string): string {
    return (actions[action] ?? []).map(keyLabel).join("/");
}
