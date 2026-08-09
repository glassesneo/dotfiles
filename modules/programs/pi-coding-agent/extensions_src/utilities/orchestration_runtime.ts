import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { meshDirectory, withMeshAgentLock } from "./orchestration_lock.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface AgentRuntimeBinding {
    schemaVersion: 1;
    meshId: string;
    agentId: string;
    runtimeId: string;
    kind: "pi" | "external";
    sessionId: string | null;
    sessionFile: string | null;
    boundAt: string;
}

function runtimePath(stateRoot: string, meshId: string, agentId: string): string {
    return join(meshDirectory(stateRoot, meshId), "agents", agentId, "runtime.json");
}
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("agent runtime binding must be an object");
    return value as Record<string, unknown>;
}
function validate(value: unknown, meshId: string, agentId: string): AgentRuntimeBinding {
    const raw = object(value);
    const keys = ["schemaVersion", "meshId", "agentId", "runtimeId", "kind", "sessionId", "sessionFile", "boundAt"];
    if (Object.keys(raw).length !== keys.length || keys.some(key => !(key in raw))) throw new Error("agent runtime binding has invalid keys");
    if (raw.schemaVersion !== 1 || raw.meshId !== meshId || raw.agentId !== agentId || typeof raw.runtimeId !== "string" || !UUID.test(raw.runtimeId)) throw new Error("agent runtime binding identity is invalid");
    if (raw.kind !== "pi" && raw.kind !== "external") throw new Error("agent runtime binding kind is invalid");
    if (raw.sessionId !== null && (typeof raw.sessionId !== "string" || !raw.sessionId.trim())) throw new Error("agent runtime binding sessionId is invalid");
    if (raw.sessionFile !== null && (typeof raw.sessionFile !== "string" || !raw.sessionFile.trim())) throw new Error("agent runtime binding sessionFile is invalid");
    if (raw.kind === "pi" && (raw.sessionId === null || raw.sessionFile === null) || raw.kind === "external" && (raw.sessionId !== null || raw.sessionFile !== null)) throw new Error("agent runtime binding session identity does not match kind");
    if (typeof raw.boundAt !== "string" || !Number.isFinite(Date.parse(raw.boundAt))) throw new Error("agent runtime binding boundAt is invalid");
    return value as AgentRuntimeBinding;
}
async function optionalBinding(stateRoot: string, meshId: string, agentId: string): Promise<AgentRuntimeBinding | undefined> {
    try { return validate(JSON.parse(await readFile(runtimePath(stateRoot, meshId, agentId), "utf8")), meshId, agentId); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function atomic(path: string, value: AgentRuntimeBinding): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
}

export async function bindAgentRuntime(stateRoot: string, meshId: string, agentId: string, input: { runtimeId: string; kind: "pi" | "external"; sessionId?: string; sessionFile?: string }): Promise<AgentRuntimeBinding> {
    if (!UUID.test(input.runtimeId)) throw new Error("agent runtime ID must be a UUID");
    return withMeshAgentLock(stateRoot, meshId, agentId, async () => {
        const existing = await optionalBinding(stateRoot, meshId, agentId);
        const sessionId = input.kind === "pi" ? input.sessionId?.trim() || null : null;
        const sessionFile = input.kind === "pi" ? input.sessionFile?.trim() || null : null;
        if (input.kind === "pi" && (!sessionId || !sessionFile)) throw new Error("Pi runtime binding requires sessionId and sessionFile");
        if (existing?.kind === input.kind && existing.runtimeId === input.runtimeId) return existing;
        const binding: AgentRuntimeBinding = { schemaVersion: 1, meshId, agentId, runtimeId: input.runtimeId, kind: input.kind, sessionId, sessionFile, boundAt: new Date().toISOString() };
        await atomic(runtimePath(stateRoot, meshId, agentId), binding);
        return binding;
    });
}
export async function readAgentRuntimeBinding(stateRoot: string, meshId: string, agentId: string): Promise<AgentRuntimeBinding | undefined> {
    return optionalBinding(stateRoot, meshId, agentId);
}
export async function readCurrentPiRuntimeGeneration(stateRoot: string, meshId: string, agentId: string, sessionId: string, sessionFile: string): Promise<AgentRuntimeBinding> {
    const binding = await optionalBinding(stateRoot, meshId, agentId);
    if (!binding || binding.kind !== "pi" || binding.sessionId !== sessionId || binding.sessionFile !== sessionFile) throw new Error(`Agent ${agentId} Pi runtime generation was not bound by orchestration`);
    return binding;
}
export async function assertCurrentAgentRuntime(stateRoot: string, meshId: string, agentId: string, runtimeId: string): Promise<AgentRuntimeBinding> {
    const binding = await optionalBinding(stateRoot, meshId, agentId);
    if (!binding || binding.runtimeId !== runtimeId) throw new Error(`Agent ${agentId} runtime is stale or unbound`);
    return binding;
}
