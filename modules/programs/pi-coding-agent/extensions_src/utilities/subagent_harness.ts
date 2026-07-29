import type { AgentProfile } from "./profile_types.ts";
import { piLaunchDescriptor } from "./subagent_pi.ts";
import type { NativeCapabilities, SubagentRuntimeConfig } from "./subagent_types.ts";

export interface NativeLaunchDescriptor { command: string; args: string[]; env: Record<string, string>; }
export interface NativeHarnessAdapter { id: string; capabilities: NativeCapabilities; launch(config: SubagentRuntimeConfig, input: { agentId: string; agentDirectory: string; profile: string; profileSnapshot: AgentProfile; depth: number; originSessionId: string; originSessionFile?: string }): NativeLaunchDescriptor }
const pi: NativeHarnessAdapter = { id: "pi", capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, launch: piLaunchDescriptor };
export const harnessAdapters: Readonly<Record<string, NativeHarnessAdapter>> = Object.freeze({ pi });
export function resolveHarnessAdapter(id: string): NativeHarnessAdapter { const adapter = harnessAdapters[id]; if (!adapter) throw new Error(`Unknown subagent harness: ${id}`); return adapter; }
