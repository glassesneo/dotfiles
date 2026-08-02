import type { AgentProfile } from "./profile_types.ts";
import { piLaunchDescriptor } from "./subagent_pi.ts";
import type { HarnessRuntimeConfig, NativeCapabilities, SubagentRuntimeConfig } from "./subagent_types.ts";

export interface NativeLaunchDescriptor { command: string; args: string[]; env: Record<string, string>; }
export interface HarnessLaunchInput { agentId: string; agentDirectory: string; profile: string; profileSnapshot: AgentProfile; depth: number; originSessionId: string; originSessionFile?: string; cwd: string }
export interface HarnessAdapter {
    kind: HarnessRuntimeConfig["adapter"];
    capabilities: NativeCapabilities;
    validate(profile: AgentProfile, harnessId: string): void;
    launch(config: SubagentRuntimeConfig, harness: HarnessRuntimeConfig, input: HarnessLaunchInput): NativeLaunchDescriptor;
}

const pi: HarnessAdapter = {
    kind: "pi-native",
    capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true },
    validate(profile, harnessId) {
        const facet = profile.extensions.subagent as Record<string, unknown> | undefined;
        if (harnessId !== "pi") throw new Error("pi-native adapter must use the pi harness");
        if (facet?.harnessOptions !== undefined) throw new Error("pi-native profiles must not declare harnessOptions");
    },
    launch(config, _harness, input) { return piLaunchDescriptor(config, input); },
};

const CURSOR_OPTIONS = {
    mode: "agent",
    permissionPolicy: "allow-always",
    sandbox: "disabled",
    trustWorkspace: true,
    worktree: false,
} as const;

function cursorOptions(profile: AgentProfile): typeof CURSOR_OPTIONS {
    if (!profile.model.startsWith("cursor/") || profile.model.slice("cursor/".length).includes("/")) throw new Error(`Cursor profile model must use cursor/<model>: ${profile.model}`);
    if (profile.thinkingLevel !== undefined) throw new Error("Cursor profiles must not declare thinkingLevel");
    if (profile.allowAllTools || profile.tools.length !== 0) throw new Error("Cursor profiles must use allowAllTools=false and tools=[]");
    const facet = profile.extensions.subagent as Record<string, unknown> | undefined;
    const value = facet?.harnessOptions;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cursor profile requires harnessOptions");
    const options = value as Record<string, unknown>;
    const unknown = Object.keys(options).filter(key => !(key in CURSOR_OPTIONS));
    if (unknown.length) throw new Error(`Cursor harnessOptions contains unknown keys: ${unknown.join(", ")}`);
    for (const [key, expected] of Object.entries(CURSOR_OPTIONS)) if (options[key] !== expected) throw new Error(`Cursor harnessOptions.${key} must be ${String(expected)}`);
    return CURSOR_OPTIONS;
}

const cursor: HarnessAdapter = {
    kind: "cursor-acp",
    capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: false, interactiveInterventions: false, terminalHistory: false },
    validate(profile) { cursorOptions(profile); },
    launch(config, harness, input) {
        cursorOptions(input.profileSnapshot);
        if (!harness.workerCommand || !harness.workerEntrypoint) throw new Error("cursor-acp harness worker is incomplete");
        return {
            command: harness.workerCommand,
            args: ["--experimental-strip-types", harness.workerEntrypoint],
            env: {
                PI_SUBAGENT_AGENT_ID: input.agentId,
                PI_SUBAGENT_AGENT_DIR: input.agentDirectory,
                PI_SUBAGENT_STATE_ROOT: config.stateRoot,
                PI_SUBAGENT_EXTERNAL_CONFIG: JSON.stringify({
                    adapter: "cursor-acp",
                    command: harness.command,
                    cwd: input.cwd,
                    model: input.profileSnapshot.model.slice("cursor/".length),
                    profile: input.profile,
                    instructions: input.profileSnapshot.instructions ?? "",
                    permissionPolicy: CURSOR_OPTIONS.permissionPolicy,
                }),
            },
        };
    },
};

export const harnessAdapters: Readonly<Record<HarnessRuntimeConfig["adapter"], HarnessAdapter>> = Object.freeze({ "pi-native": pi, "cursor-acp": cursor });
export function resolveHarnessAdapter(config: SubagentRuntimeConfig, id: string, profile?: AgentProfile): { adapter: HarnessAdapter; harness: HarnessRuntimeConfig } {
    const harness = config.harnesses[id];
    if (!harness) throw new Error(`Unknown subagent harness: ${id}`);
    const adapter = harnessAdapters[harness.adapter];
    if (!adapter) throw new Error(`Unknown subagent harness adapter: ${String(harness.adapter)}`);
    if (profile) adapter.validate(profile, id);
    return { adapter, harness };
}
