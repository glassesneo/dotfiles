import type { AgentLaunchEnvelope } from "./agent_types.ts";
import { isApprovedCursorHarnessOptions, type ExecutionConfig } from "./mode_types.ts";
import { piLaunchDescriptor } from "./orchestration_pi.ts";
import type { HarnessRuntimeConfig, NativeCapabilities, SubagentRuntimeConfig } from "./orchestration_types.ts";

export interface NativeLaunchDescriptor { command: string; args: string[]; env: Record<string, string> }
export interface HarnessLaunchInput { meshId: string; agentId: string; agentDirectory: string; childId: string; taskPath: string; launchEnvelope: string; epochSnapshot: AgentLaunchEnvelope; cwd: string; resolvedCursorAcpModelId?: string }
export interface HarnessAdapter { kind: HarnessRuntimeConfig["adapter"]; capabilities: NativeCapabilities; validate(execution: ExecutionConfig, harnessId: string): void; launch(config: SubagentRuntimeConfig, harness: HarnessRuntimeConfig, input: HarnessLaunchInput): NativeLaunchDescriptor }

const expectedCodex = { mode: "read-only", permissionPolicy: "reject", webSearch: "cached" } as const;
const externalCapabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: false, interactiveInterventions: false, terminalHistory: false } as const;
function exactOptions(value: Record<string, unknown> | undefined, expected: Record<string, unknown>, label: string): void {
    if (!value || Object.keys(value).length !== Object.keys(expected).length) throw new Error(`${label} requires exact harnessOptions`);
    for (const [key, item] of Object.entries(expected)) if (value[key] !== item) throw new Error(`${label} harnessOptions.${key} must be ${String(item)}`);
}
function piOptions(execution: ExecutionConfig, harnessId: string): void {
    if (harnessId !== "pi" || execution.harness !== "pi" || execution.harnessOptions !== undefined) throw new Error("Pi execution must use pi without harnessOptions");
}
function cursorOptions(execution: ExecutionConfig, harnessId: string): void {
    if (harnessId !== "cursor-agent" || execution.harness !== "cursor-agent" || execution.models.length !== 1 || !execution.models[0]!.startsWith("cursor/") || execution.thinkingLevel !== undefined) throw new Error("Cursor execution requires cursor-agent, cursor/<model>, and no thinkingLevel");
    if (!isApprovedCursorHarnessOptions(execution.harnessOptions)) throw new Error("Cursor execution requires exact approved harnessOptions");
}
function codexOptions(execution: ExecutionConfig, harnessId: string): void {
    if (harnessId !== "codex" || execution.harness !== "codex" || execution.models.length !== 1 || !execution.models[0]!.startsWith("codex/") || !execution.thinkingLevel) throw new Error("Codex execution requires codex, codex/<model>, and thinkingLevel");
    exactOptions(execution.harnessOptions, expectedCodex, "Codex execution");
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
const cursor: HarnessAdapter = { kind: "cursor-acp", capabilities: externalCapabilities, validate: cursorOptions, launch(_config, harness, input) { const envelope = selected(input); cursorOptions(envelope.self.execution, envelope.self.execution.harness); const options = envelope.self.execution.harnessOptions!; if (!input.resolvedCursorAcpModelId) throw new Error("Cursor launch requires a resolved ACP model ID"); return externalLaunch(harness, input, { adapter: "cursor-acp", command: harness.command, cwd: input.cwd, expectedAcpModelId: input.resolvedCursorAcpModelId, mode: String(options.mode), permissionPolicy: String(options.permissionPolicy) }); } };
const codex: HarnessAdapter = { kind: "codex-acp", capabilities: externalCapabilities, validate: codexOptions, launch(_config, harness, input) { const envelope = selected(input); codexOptions(envelope.self.execution, envelope.self.execution.harness); return externalLaunch(harness, input, { adapter: "codex-acp", command: harness.command, cwd: input.cwd, mode: expectedCodex.mode, permissionPolicy: expectedCodex.permissionPolicy, webSearch: expectedCodex.webSearch }); } };
export function resolveCursorAcpModelId(config: SubagentRuntimeConfig, execution: ExecutionConfig): string | undefined {
    if (execution.harness !== "cursor-agent") return undefined;
    cursorOptions(execution, execution.harness);
    const alias = execution.models[0]!.slice("cursor/".length);
    const modelId = config.harnesses[execution.harness]?.modelIds?.[alias];
    if (!modelId) throw new Error(`Cursor ACP model mapping is unavailable for ${alias}`);
    return modelId;
}
export const harnessAdapters = Object.freeze({ "pi-native": pi, "cursor-acp": cursor, "codex-acp": codex });
export function resolveHarnessAdapter(config: SubagentRuntimeConfig, id: string, execution?: ExecutionConfig): { adapter: HarnessAdapter; harness: HarnessRuntimeConfig } {
    const harness = config.harnesses[id];
    if (!harness) throw new Error(`Unknown orchestration harness: ${id}`);
    const adapter = harnessAdapters[harness.adapter];
    if (execution) adapter.validate(execution, id);
    return { adapter, harness };
}
