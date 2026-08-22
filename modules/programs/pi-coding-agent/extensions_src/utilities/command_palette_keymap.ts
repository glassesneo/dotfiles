import { matchesKey, type KeyId } from "@earendil-works/pi-tui";
import { canonicalKeyId, isValidKeyId } from "./private_key_id.ts";
import { keyLabel, loadFeatureKeybindings } from "./extension_keybindings.ts";

export const paletteActions = ["open", "moveUp", "moveDown", "collapse", "expand", "confirm", "cancel", "refresh", "stop", "preview", "unlink", "toggleTerminal"] as const;
export type PaletteKeyAction = (typeof paletteActions)[number];
export type PaletteKeymapConfig = Partial<Record<PaletteKeyAction, string[]>>;
export type ResolvedPaletteKeymap = Record<PaletteKeyAction, KeyId[]>;

export const defaultPaletteKeymap: ResolvedPaletteKeymap = {
    open: ["ctrl+shift+p"], moveUp: ["ctrl+p"], moveDown: ["ctrl+n"], collapse: ["left"], expand: ["right"],
    confirm: ["enter"], cancel: ["escape", "ctrl+c"], refresh: [], stop: ["x"], preview: ["space"], unlink: [], toggleTerminal: [],
};

export function validatePaletteKeymapConfig(value: unknown, path = "extension-keybindings.json"): PaletteKeymapConfig {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: expected an object`);
    for (const [action, keys] of Object.entries(value)) {
        if (!(paletteActions as readonly string[]).includes(action)) throw new Error(`${path}: unknown action ${action}`);
        if (!Array.isArray(keys) || keys.some(key => typeof key !== "string")) throw new Error(`${path}: ${action} must be an array of keys`);
        for (const key of keys as string[]) if (!isValidKeyId(key)) throw new Error(`${path}: ${action}: invalid key ${JSON.stringify(key)}`);
    }
    return value as PaletteKeymapConfig;
}

export function resolvePaletteKeymap(config: PaletteKeymapConfig = {}, path = "extension-keybindings.json", required: readonly PaletteKeyAction[] = []): ResolvedPaletteKeymap {
    const validated = validatePaletteKeymapConfig(config, path);
    const result = Object.fromEntries(paletteActions.map(action => [action, [...(validated[action] ?? defaultPaletteKeymap[action])]])) as ResolvedPaletteKeymap;
    for (const action of required) if (result[action].length === 0) throw new Error(`${path}: required action ${action} has no keys`);
    const byKey = new Map<string, PaletteKeyAction[]>();
    for (const action of paletteActions) for (const key of result[action]) {
        const canonical = canonicalKeyId(key);
        byKey.set(canonical, [...(byKey.get(canonical) ?? []), action]);
    }
    for (const [key, actions] of byKey) if (actions.length > 1) throw new Error(`${path}: key ${key} conflicts between ${actions.join(", ")}`);
    return result;
}

export function loadPaletteKeymap(agentDir?: string, feature = "commandPalette"): { keymap: ResolvedPaletteKeymap; path: string } {
    const loaded = loadFeatureKeybindings(feature, agentDir);
    const config = Object.fromEntries(paletteActions.map(action => [action, loaded.actions[action] ?? []])) as PaletteKeymapConfig;
    const required: PaletteKeyAction[] = feature === "commandPalette"
        ? ["open", "moveUp", "moveDown", "collapse", "expand", "confirm", "cancel"]
        : ["moveUp", "moveDown", "collapse", "expand", "confirm", "cancel"];
    return { keymap: resolvePaletteKeymap(config, loaded.path, required), path: loaded.path };
}

export function paletteKeyAction(data: string, keymap: ResolvedPaletteKeymap): PaletteKeyAction | undefined {
    for (const action of paletteActions) if (keymap[action].some(key => matchesKey(data, key))) return action;
    return undefined;
}

const labels: Record<PaletteKeyAction, string> = {
    open: "open", moveUp: "up", moveDown: "down", collapse: "collapse", expand: "expand", confirm: "select",
    cancel: "cancel", refresh: "refresh", stop: "stop", preview: "preview", unlink: "unlink", toggleTerminal: "terminal history",
};
export function paletteHelp(keymap: ResolvedPaletteKeymap, actions: readonly PaletteKeyAction[] = ["moveUp", "moveDown", "confirm", "cancel"]): string {
    return actions.filter(action => keymap[action].length > 0).map(action => `${keyLabel(keymap[action][0]!)} ${labels[action]}`).join(" • ");
}
