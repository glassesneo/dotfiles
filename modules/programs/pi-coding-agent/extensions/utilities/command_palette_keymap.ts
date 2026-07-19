import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { matchesKey, type KeyId } from "@earendil-works/pi-tui";

export const paletteActions = ["open", "moveUp", "moveDown", "confirm", "cancel"] as const;
export type PaletteKeyAction = (typeof paletteActions)[number];
export type PaletteKeymapConfig = Partial<Record<PaletteKeyAction, string[]>>;
export type ResolvedPaletteKeymap = Record<PaletteKeyAction, KeyId[]>;

export const defaultPaletteKeymap: ResolvedPaletteKeymap = {
    open: ["ctrl+shift+p"], moveUp: ["ctrl+p"], moveDown: ["ctrl+n"],
    confirm: ["enter"], cancel: ["escape", "ctrl+c"],
};

function validKey(key: string): boolean {
    const parts = key.split("+");
    if (parts.some(part => part.length === 0)) return false;
    const base = parts.at(-1)!; const modifiers = parts.slice(0, -1);
    if (new Set(modifiers).size !== modifiers.length || modifiers.some(mod => !["ctrl", "shift", "alt"].includes(mod))) return false;
    return /^[a-z0-9]$/.test(base) || /^(escape|esc|enter|return|tab|space|backspace|delete|insert|clear|home|end|pageUp|pageDown|up|down|left|right|f(?:[1-9]|1[0-2])|[`\-=\[\]\\;',./!@#$%^&*()_+|~{}:<>?])$/.test(base);
}

export function validatePaletteKeymapConfig(value: unknown, path = "command-palette-keybindings.json"): PaletteKeymapConfig {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: expected an object`);
    for (const [action, keys] of Object.entries(value)) {
        if (!(paletteActions as readonly string[]).includes(action)) throw new Error(`${path}: unknown action ${action}`);
        if (!Array.isArray(keys) || keys.some(key => typeof key !== "string")) throw new Error(`${path}: ${action} must be an array of keys`);
        for (const key of keys as string[]) if (!validKey(key)) throw new Error(`${path}: ${action}: invalid key ${JSON.stringify(key)}`);
    }
    return value as PaletteKeymapConfig;
}

export function resolvePaletteKeymap(config: PaletteKeymapConfig = {}, path = "command-palette-keybindings.json"): ResolvedPaletteKeymap {
    validatePaletteKeymapConfig(config, path);
    const result = Object.fromEntries(paletteActions.map(action => [action, [...(config[action] ?? defaultPaletteKeymap[action])]])) as ResolvedPaletteKeymap;
    for (const action of paletteActions) if (result[action].length === 0) throw new Error(`${path}: required action ${action} has no keys`);
    const byKey = new Map<string, PaletteKeyAction[]>();
    for (const action of paletteActions) for (const key of result[action]) byKey.set(key, [...(byKey.get(key) ?? []), action]);
    for (const [key, actions] of byKey) if (actions.length > 1) throw new Error(`${path}: key ${key} conflicts between ${actions.join(", ")}`);
    return result;
}

export function loadPaletteKeymap(agentDir = getAgentDir()): { keymap: ResolvedPaletteKeymap; path: string } {
    const path = join(agentDir, "command-palette-keybindings.json");
    if (!existsSync(path)) return { keymap: resolvePaletteKeymap(), path: "<bundled command-palette-keybindings.json>" };
    let value: unknown;
    try { value = JSON.parse(readFileSync(path, "utf8")); }
    catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
    return { keymap: resolvePaletteKeymap(value as PaletteKeymapConfig, path), path };
}

export function paletteKeyAction(data: string, keymap: ResolvedPaletteKeymap): PaletteKeyAction | undefined {
    for (const action of paletteActions) if (keymap[action].some(key => matchesKey(data, key))) return action;
    return undefined;
}

const labels: Record<PaletteKeyAction, string> = { open: "open", moveUp: "up", moveDown: "down", confirm: "select", cancel: "cancel" };
export function paletteHelp(keymap: ResolvedPaletteKeymap, actions: readonly PaletteKeyAction[] = ["moveUp", "moveDown", "confirm", "cancel"]): string {
    return actions.map(action => `${keymap[action][0]} ${labels[action]}`).join(" • ");
}
