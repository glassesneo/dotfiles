import type { NativeLaunchDescriptor } from "./subagent_harness.ts";
import type { AgentProfile } from "./profile_types.ts";
import type { SubagentRuntimeConfig } from "./subagent_types.ts";

export function piLaunchDescriptor(config: SubagentRuntimeConfig, input: { agentId: string; agentDirectory: string; profile: string; profileSnapshot: AgentProfile; depth: number; originSessionId: string; originSessionFile?: string }): NativeLaunchDescriptor {
    const profile = input.profileSnapshot;
    const args = ["--session-dir", `${input.agentDirectory}/session`, "--no-extensions"];
    for (const extension of config.childExtensions) args.push("-e", extension);
    args.push("--profile", input.profile, "--model", profile.model);
    if (profile.thinkingLevel) args.push("--thinking", profile.thinkingLevel);
    if (!profile.allowAllTools) args.push(profile.tools.length ? "--tools" : "--no-tools", ...(profile.tools.length ? [profile.tools.join(",")] : []));
    return { command: config.harnesses.pi.command, args, env: {
        PI_SUBAGENT_AGENT_ID: input.agentId,
        PI_SUBAGENT_AGENT_DIR: input.agentDirectory,
        PI_SUBAGENT_DEPTH: String(input.depth),
        PI_SUBAGENT_ORIGIN_SESSION_ID: input.originSessionId,
        PI_AGENT_RESOLVED_PROFILE: JSON.stringify({ name: input.profile, profile }),
        ...(input.originSessionFile ? { PI_SUBAGENT_ORIGIN_SESSION_FILE: input.originSessionFile } : {}),
    } };
}
