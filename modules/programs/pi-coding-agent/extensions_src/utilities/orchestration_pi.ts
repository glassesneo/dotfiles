import type { AgentLaunchEnvelope } from "./agent_types.ts";
import type { NativeLaunchDescriptor } from "./orchestration_harness.ts";
import type { SubagentRuntimeConfig } from "./orchestration_types.ts";

export const MESH_PEER_TOOL_NAMES = Object.freeze(["mesh_run", "mesh_submit", "mesh_get", "mesh_wait", "mesh_stop", "mesh_route"] as const);
export const MESH_BOOTSTRAP_TOOL_NAME = "mesh_enable" as const;

export function meshPiLaunchTools(roleTools: readonly string[]): string[] {
    return [...new Set([...roleTools, MESH_BOOTSTRAP_TOOL_NAME, ...MESH_PEER_TOOL_NAMES])];
}

export function piLaunchDescriptor(config: SubagentRuntimeConfig, input: { meshId: string; agentId: string; agentDirectory: string; agent: string; taskPath: string; launchEnvelope: string; epochSnapshot: AgentLaunchEnvelope }): NativeLaunchDescriptor {
    const epoch = input.epochSnapshot;
    if (epoch.meshId !== input.meshId || epoch.agentId !== input.agentId) throw new Error("Pi launch metadata does not match the immutable epoch snapshot");
    const definition = epoch.self;
    const extensions = epoch.childExtensions[input.agent];
    if (!extensions) throw new Error(`Immutable epoch snapshot has no child manifest for ${input.agent}`);
    const args = ["--session-dir", `${input.agentDirectory}/session`, "--no-extensions"];
    for (const extension of extensions) args.push("-e", extension);
    args.push("--model", definition.model);
    if (definition.thinkingLevel) args.push("--thinking", definition.thinkingLevel);
    args.push("--tools", meshPiLaunchTools(definition.tools).join(","));
    return {
        command: config.harnesses.pi!.command,
        args,
        env: {
            PI_MESH_ID: input.meshId,
            PI_MESH_AGENT_ID: input.agentId,
            PI_MESH_AGENT_DIR: input.agentDirectory,
            PI_MESH_EPOCH_ID: epoch.epochId,
            PI_MESH_TASK_PATH: input.taskPath,
            PI_AGENT_RESOLVED_AGENT: input.launchEnvelope,
        },
    };
}
