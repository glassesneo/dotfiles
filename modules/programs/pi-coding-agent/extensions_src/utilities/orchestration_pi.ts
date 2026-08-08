import type { NativeLaunchDescriptor } from "./orchestration_harness.ts";
import type { SubagentRuntimeConfig } from "./orchestration_types.ts";
export function piLaunchDescriptor(config: SubagentRuntimeConfig, input: { agentId: string; agentDirectory: string; agent: string; launchEnvelope: string; launchEnvelopeSnapshot: import("./agent_types.ts").AgentLaunchEnvelope; depth: number; originSessionId: string; originSessionFile?: string }): NativeLaunchDescriptor {
    const definition = input.launchEnvelopeSnapshot.self;
    const extensions = input.launchEnvelopeSnapshot.childExtensions[input.agent];
    if (!extensions) throw new Error(`Launch envelope has no child manifest for ${input.agent}`);
    const args = ["--session-dir", `${input.agentDirectory}/session`, "--no-extensions"];
    for (const extension of extensions) args.push("-e", extension);
    args.push("--model", definition.model);
    if (definition.thinkingLevel) args.push("--thinking", definition.thinkingLevel);
    args.push(definition.tools.length ? "--tools" : "--no-tools", ...(definition.tools.length ? [definition.tools.join(",")] : []));
    return { command: config.harnesses.pi!.command, args, env: { PI_SUBAGENT_AGENT_ID: input.agentId, PI_SUBAGENT_AGENT_DIR: input.agentDirectory, PI_SUBAGENT_DEPTH: String(input.depth), PI_SUBAGENT_ORIGIN_SESSION_ID: input.originSessionId, PI_AGENT_RESOLVED_AGENT: input.launchEnvelope, ...(input.originSessionFile ? { PI_SUBAGENT_ORIGIN_SESSION_FILE: input.originSessionFile } : {}) } };
}
