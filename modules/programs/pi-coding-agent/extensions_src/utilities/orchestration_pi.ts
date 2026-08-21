import type { AgentLaunchEnvelope, CallerPolicy } from "./agent_types.ts";
import type { NativeLaunchDescriptor } from "./orchestration_harness.ts";
import type { SubagentRuntimeConfig } from "./orchestration_types.ts";

export const MESH_PEER_TOOL_NAMES = Object.freeze(["mesh_submit", "mesh_get", "mesh_wait", "mesh_stop", "mesh_signal"] as const);

export function meshPiLaunchTools(roleTools: readonly string[], policy: CallerPolicy): string[] {
    const canDispatch = Object.keys(policy.targets).length > 0;
    return [...new Set([...roleTools, ...(canDispatch ? MESH_PEER_TOOL_NAMES : [])])];
}

function runtimeExtensions(envelope: AgentLaunchEnvelope): string[] {
    const extensions = envelope.childExtensions[envelope.role];
    if (!extensions) throw new Error(`Immutable launch envelope has no child manifest for ${envelope.role}`);
    if (envelope.selfRole.contextPolicy !== "prompt-only") return extensions;
    return extensions.filter(path => /(?:^|\/)(?:orchestration|orchestration_child_bridge)\.ts$/u.test(path));
}

export function piLaunchDescriptor(config: SubagentRuntimeConfig, input: { meshId: string; agentId: string; agentDirectory: string; role: string; taskPath: string; launchEnvelope: string; epochSnapshot: AgentLaunchEnvelope }): NativeLaunchDescriptor {
    const envelope = input.epochSnapshot;
    if (envelope.meshId !== input.meshId || envelope.agentId !== input.agentId) throw new Error("Pi launch metadata does not match the immutable launch envelope");
    if (envelope.role !== input.role) throw new Error("Pi launch role does not match the immutable launch envelope");
    const profile = envelope.executionProfile;
    if (profile.harness !== "pi" || profile.harnessOptions !== undefined) throw new Error(`Selected profile ${envelope.selectedProfile} is not a Pi execution profile`);

    const args = ["--session-dir", `${input.agentDirectory}/session`, "--no-extensions"];
    for (const extension of runtimeExtensions(envelope)) args.push("-e", extension);
    args.push("--model", profile.model);
    if (profile.thinkingLevel) args.push("--thinking", profile.thinkingLevel);

    if (envelope.selfRole.contextPolicy === "prompt-only") {
        args.push("--no-context-files", "--no-skills", "--no-prompt-templates", "--no-tools");
    } else {
        const tools = meshPiLaunchTools(envelope.selfRole.tools, envelope.policies[envelope.role] ?? { targets: {} });
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
