import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const AGENT_MODE_STATE = "agent-mode-state";
const PONYTAIL_MODE = "ponytail-mode";
const AUTO_MODES = new Set(["leader", "ops"]);
const RULESET_LEVEL = "full";

const ponytailRequire = createRequire(import.meta.url);
const hooksPath = join(
    getAgentDir(),
    "npm",
    "node_modules",
    "@dietrichgebert/ponytail",
    "hooks",
    "ponytail-instructions.js",
);

let ruleset: string | undefined;
let rulesetUnavailable = false;

function loadRuleset(ctx: ExtensionContext | undefined): string | undefined {
    if (ruleset) return ruleset;
    if (rulesetUnavailable) return undefined;
    try {
        const hooks = ponytailRequire(hooksPath) as {
            getPonytailInstructions?: (level: string) => unknown;
        };
        const text = hooks.getPonytailInstructions?.(RULESET_LEVEL);
        if (typeof text === "string" && text.length > 0) {
            ruleset = text;
            return text;
        }
    } catch {
        // Fall through: treat the ruleset as unavailable.
    }
    rulesetUnavailable = true;
    ctx?.ui?.notify?.("ponytail-auto: ruleset unavailable; auto-injection disabled for this session", "warning");
    return undefined;
}

function latestCustomData(ctx: ExtensionContext, customType: string): unknown {
    const branch = ctx.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i -= 1) {
        const entry = branch[i] as { type?: unknown; customType?: unknown; data?: unknown } | undefined;
        if (entry?.type === "custom" && entry?.customType === customType) return entry.data;
    }
    return undefined;
}

function currentAgentMode(ctx: ExtensionContext): string | undefined {
    const data = latestCustomData(ctx, AGENT_MODE_STATE) as {
        schemaVersion?: unknown;
        mode?: unknown;
    } | undefined;
    if (data && data.schemaVersion === 2 && typeof data.mode === "string") return data.mode;
    try {
        const config = JSON.parse(readFileSync(join(getAgentDir(), "agent-modes.json"), "utf8")) as {
            defaultMode?: unknown;
        };
        if (typeof config.defaultMode === "string") return config.defaultMode;
    } catch {
        // Config unavailable: fall through to no injection.
    }
    return undefined;
}

export default function ponytailAutoExtension(pi: ExtensionAPI): void {
    pi.on("before_agent_start", (event, ctx) => {
        // A manual /ponytail level owns injection for this session; never double-inject.
        if (latestCustomData(ctx, PONYTAIL_MODE) !== undefined) return;
        const mode = currentAgentMode(ctx);
        if (mode === undefined || !AUTO_MODES.has(mode)) return;
        const text = loadRuleset(ctx);
        if (!text) return;
        const base = event.systemPrompt ? `${event.systemPrompt}\n\n` : "";
        return { systemPrompt: `${base}${text}` };
    });
}
