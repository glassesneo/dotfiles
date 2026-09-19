import type { AgentLaunchEnvelope } from "./agent_types.ts";
import type { NativeLaunchDescriptor } from "./orchestration_harness.ts";
import { END_RESPONSE_TOOL_NAME } from "./orchestration_execution.ts";
import type { SubagentRuntimeConfig } from "./orchestration_types.ts";

export const MESH_REPORT_TOOL_NAME = "mesh_report" as const;
export const MESH_PEER_TOOL_NAMES = Object.freeze(["mesh_send", "mesh_get", "mesh_stop", "mesh_control", MESH_REPORT_TOOL_NAME] as const);

export function meshPiLaunchTools(roleTools: readonly string[], targets: readonly string[]): string[] {
    const canDispatch = targets.length > 0;
    return [...new Set([...roleTools, END_RESPONSE_TOOL_NAME, ...(canDispatch ? MESH_PEER_TOOL_NAMES : [MESH_REPORT_TOOL_NAME])])];
}

export function coreChildExtensionPaths(config: SubagentRuntimeConfig): string[] {
    return [config.popupExtension, config.orchestrationExtension, config.childBridgeExtension];
}

export function buildChildExtensionManifest(config: SubagentRuntimeConfig, contextPolicy: string, contributions: readonly string[]): string[] {
    const core = coreChildExtensionPaths(config);
    const coreSet = new Set(core);
    const manifest: string[] = [];
    if (contextPolicy === "project") manifest.push(core[0]!);
    manifest.push(core[1]!);
    for (const contribution of contributions) {
        if (!coreSet.has(contribution) && !manifest.includes(contribution)) manifest.push(contribution);
    }
    manifest.push(core[2]!);
    return manifest;
}

function runtimeExtensions(envelope: AgentLaunchEnvelope): string[] {
    const extensions = envelope.childExtensions[envelope.childId];
    if (!extensions) throw new Error(`Immutable launch envelope has no child manifest for ${envelope.childId}`);
    return extensions;
}

export function piLaunchDescriptor(config: SubagentRuntimeConfig, input: { meshId: string; agentId: string; agentDirectory: string; childId: string; taskPath: string; launchEnvelope: string; epochSnapshot: AgentLaunchEnvelope }): NativeLaunchDescriptor {
    const envelope = input.epochSnapshot;
    if (envelope.meshId !== input.meshId || envelope.agentId !== input.agentId) throw new Error("Pi launch metadata does not match the immutable launch envelope");
    if (envelope.childId !== input.childId) throw new Error("Pi launch child does not match the immutable launch envelope");
    const execution = envelope.self.execution;
    if (execution.harness !== "pi" || execution.harnessOptions !== undefined) throw new Error("Selected execution is not Pi execution");

    const args = ["--session-dir", `${input.agentDirectory}/session`, "--no-extensions"];
    for (const extension of runtimeExtensions(envelope)) args.push("-e", extension);
    args.push("--model", execution.models[envelope.initialCandidateIndex] ?? execution.models[0]!);
    if (execution.thinkingLevel) args.push("--thinking", execution.thinkingLevel);

    if (envelope.self.contextPolicy === "prompt-only") {
        args.push("--no-context-files", "--no-skills", "--no-prompt-templates", "--no-tools");
    } else {
        const tools = meshPiLaunchTools(envelope.self.tools, envelope.self.targets);
        if (tools.length) args.push("--tools", tools.join(","));
        else args.push("--no-tools");
    }
    return {
        command: config.harnesses.pi!.command,
        args,
        env: {
            PI_MESH_ID: input.meshId,
            PI_MESH_AGENT_ID: input.agentId,
            PI_MESH_AGENT_DIR: input.agentDirectory,
            PI_MESH_EPOCH_ID: envelope.epochId,
            PI_MESH_TASK_PATH: input.taskPath,
            PI_AGENT_RESOLVED_AGENT: input.launchEnvelope,
        },
    };
}
