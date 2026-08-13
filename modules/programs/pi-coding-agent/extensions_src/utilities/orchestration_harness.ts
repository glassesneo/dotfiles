import type { AgentLaunchEnvelope } from "./agent_types.ts";
import type { ExecutionProfile } from "./mode_types.ts";
import { piLaunchDescriptor } from "./orchestration_pi.ts";
import type { HarnessRuntimeConfig, NativeCapabilities, SubagentRuntimeConfig } from "./orchestration_types.ts";

export interface NativeLaunchDescriptor { command: string; args: string[]; env: Record<string, string> }
export interface HarnessLaunchInput { meshId: string; agentId: string; agentDirectory: string; role: string; taskPath: string; launchEnvelope: string; epochSnapshot: AgentLaunchEnvelope; cwd: string }
export interface HarnessAdapter { kind: HarnessRuntimeConfig["adapter"]; capabilities: NativeCapabilities; validate(profile: ExecutionProfile, harnessId: string): void; launch(config: SubagentRuntimeConfig, harness: HarnessRuntimeConfig, input: HarnessLaunchInput): NativeLaunchDescriptor }

const expectedCursor = { mode: "agent", permissionPolicy: "allow-always", sandbox: "disabled", trustWorkspace: true, worktree: false } as const;
const expectedCodex = { mode: "read-only", permissionPolicy: "reject", webSearch: "cached" } as const;
const externalCapabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: false, interactiveInterventions: false, terminalHistory: false } as const;
function exactOptions(value: Record<string, unknown> | undefined, expected: Record<string, unknown>, label: string): void {
    if (!value || Object.keys(value).length !== Object.keys(expected).length) throw new Error(`${label} requires exact harnessOptions`);
    for (const [key, item] of Object.entries(expected)) if (value[key] !== item) throw new Error(`${label} harnessOptions.${key} must be ${String(item)}`);
}
function piOptions(profile: ExecutionProfile, harnessId: string): void {
    if (harnessId !== "pi" || profile.harness !== "pi" || profile.harnessOptions !== undefined) throw new Error("Pi execution profiles must use pi without harnessOptions");
}
function cursorOptions(profile: ExecutionProfile, harnessId: string): void {
    if (harnessId !== "cursor-agent" || profile.harness !== "cursor-agent" || !profile.model.startsWith("cursor/") || profile.thinkingLevel !== undefined) throw new Error("Cursor execution profiles require cursor-agent, cursor/<model>, and no thinkingLevel");
    exactOptions(profile.harnessOptions, expectedCursor, "Cursor execution profile");
}
function codexOptions(profile: ExecutionProfile, harnessId: string): void {
    if (harnessId !== "codex" || profile.harness !== "codex" || !profile.model.startsWith("codex/") || !profile.thinkingLevel) throw new Error("Codex execution profiles require codex, codex/<model>, and thinkingLevel");
    exactOptions(profile.harnessOptions, expectedCodex, "Codex execution profile");
}
function selected(input: HarnessLaunchInput): AgentLaunchEnvelope {
    const envelope = input.epochSnapshot;
    if (envelope.meshId !== input.meshId || envelope.agentId !== input.agentId) throw new Error("Launch metadata does not match the immutable launch envelope");
    return envelope;
}
function launchMetadata(input: HarnessLaunchInput): Record<string, string> {
    const envelope = selected(input);
    return { PI_MESH_ID: input.meshId, PI_MESH_AGENT_ID: input.agentId, PI_MESH_AGENT_DIR: input.agentDirectory, PI_MESH_EPOCH_ID: envelope.epochId, PI_MESH_TASK_PATH: input.taskPath, PI_AGENT_RESOLVED_AGENT: input.launchEnvelope };
}
function externalLaunch(harness: HarnessRuntimeConfig, input: HarnessLaunchInput, externalConfig: Record<string, string>): NativeLaunchDescriptor {
    if (!harness.workerCommand || !harness.workerEntrypoint) throw new Error(`${harness.adapter} harness worker is incomplete`);
    return { command: harness.workerCommand, args: ["--experimental-strip-types", harness.workerEntrypoint], env: { ...launchMetadata(input), PI_MESH_EXTERNAL_CONFIG: JSON.stringify(externalConfig) } };
}

const pi: HarnessAdapter = { kind: "pi-native", capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true }, validate: piOptions, launch: (config, _harness, input) => piLaunchDescriptor(config, input) };
const cursor: HarnessAdapter = { kind: "cursor-acp", capabilities: externalCapabilities, validate: cursorOptions, launch(_config, harness, input) { const envelope = selected(input); cursorOptions(envelope.executionProfile, envelope.executionProfile.harness); return externalLaunch(harness, input, { adapter: "cursor-acp", command: harness.command, cwd: input.cwd, permissionPolicy: expectedCursor.permissionPolicy }); } };
const codex: HarnessAdapter = { kind: "codex-acp", capabilities: externalCapabilities, validate: codexOptions, launch(_config, harness, input) { const envelope = selected(input); codexOptions(envelope.executionProfile, envelope.executionProfile.harness); return externalLaunch(harness, input, { adapter: "codex-acp", command: harness.command, cwd: input.cwd, mode: expectedCodex.mode, permissionPolicy: expectedCodex.permissionPolicy, webSearch: expectedCodex.webSearch }); } };
export const harnessAdapters = Object.freeze({ "pi-native": pi, "cursor-acp": cursor, "codex-acp": codex });
export function resolveHarnessAdapter(config: SubagentRuntimeConfig, id: string, profile?: ExecutionProfile): { adapter: HarnessAdapter; harness: HarnessRuntimeConfig } {
    const harness = config.harnesses[id];
    if (!harness) throw new Error(`Unknown orchestration harness: ${id}`);
    const adapter = harnessAdapters[harness.adapter];
    if (profile) adapter.validate(profile, id);
    return { adapter, harness };
}
