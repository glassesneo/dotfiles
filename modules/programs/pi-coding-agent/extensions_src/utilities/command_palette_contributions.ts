import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const COMMAND_PALETTE_REGISTER_EVENT = "command-palette:register";
export const COMMAND_PALETTE_DISCOVER_EVENT = "command-palette:discover";

export interface CommandPaletteContribution {
    owner: string;
    id: string;
    label: string;
    description: string;
    keywords?: readonly string[];
    currentValue?: (ctx: ExtensionContext) => string | undefined;
    disabledReason?: (ctx: ExtensionContext) => string | undefined;
    run: (ctx: ExtensionContext) => void | Promise<void>;
}

export type CommandPaletteEventBus = Pick<ExtensionAPI["events"], "emit" | "on">;

const TOKEN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export function contributionIdentity(value: Pick<CommandPaletteContribution, "owner" | "id">): string {
    return `${value.owner}:${value.id}`;
}

export function validateContribution(value: unknown, reservedIds: ReadonlySet<string> = new Set()): CommandPaletteContribution | undefined {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const item = value as Partial<CommandPaletteContribution>;
    if (typeof item.owner !== "string" || !TOKEN.test(item.owner) || typeof item.id !== "string" || !TOKEN.test(item.id)) return undefined;
    if (reservedIds.has(item.id) || typeof item.label !== "string" || item.label.trim() === "" || typeof item.description !== "string" || item.description.trim() === "" || typeof item.run !== "function") return undefined;
    if (item.keywords !== undefined && (!Array.isArray(item.keywords) || item.keywords.some(keyword => typeof keyword !== "string"))) return undefined;
    if (item.currentValue !== undefined && typeof item.currentValue !== "function") return undefined;
    if (item.disabledReason !== undefined && typeof item.disabledReason !== "function") return undefined;
    return item as CommandPaletteContribution;
}

function stableLabelCompare(left: CommandPaletteContribution, right: CommandPaletteContribution): number {
    if (left.label < right.label) return -1;
    if (left.label > right.label) return 1;
    const leftId = contributionIdentity(left); const rightId = contributionIdentity(right);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

export class CommandPaletteContributionRegistry {
    readonly #items = new Map<string, CommandPaletteContribution>();
    readonly #reservedIds: ReadonlySet<string>;
    #invalidCount = 0;

    constructor(reservedIds: Iterable<string> = []) { this.#reservedIds = new Set(reservedIds); }
    get invalidCount(): number { return this.#invalidCount; }
    register(value: unknown): boolean {
        const contribution = validateContribution(value, this.#reservedIds);
        if (!contribution) { this.#invalidCount += 1; return false; }
        this.#items.set(contributionIdentity(contribution), contribution);
        return true;
    }
    list(): CommandPaletteContribution[] { return [...this.#items.values()].sort(stableLabelCompare); }
}

export function provideCommandPaletteContribution(bus: CommandPaletteEventBus, contribution: CommandPaletteContribution): () => void {
    const register = () => bus.emit(COMMAND_PALETTE_REGISTER_EVENT, contribution);
    const unsubscribe = bus.on(COMMAND_PALETTE_DISCOVER_EVENT, register);
    register();
    return unsubscribe;
}
