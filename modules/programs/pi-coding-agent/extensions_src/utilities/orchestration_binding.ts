import { createHash } from "node:crypto";
import { join } from "node:path";
import { readOptionalJson } from "./orchestration_json.ts";
import { meshDirectory, withMeshLock } from "./orchestration_lock.ts";

export interface ExpectedEndpointBinding { endpointId: string; endpointSessionFile: string; bindingId?: string }

export function endpointRecordKey(endpointId: string): string { return createHash("sha256").update(endpointId).digest("hex"); }
export function endpointRecordPath(stateRoot: string, meshId: string, endpointId: string): string { return join(meshDirectory(stateRoot, meshId), "endpoints", `${endpointRecordKey(endpointId)}.json`); }

export async function hasExpectedEndpointBindingUnlocked(stateRoot: string, meshId: string, expected: ExpectedEndpointBinding): Promise<boolean> {
    const raw = await readOptionalJson<Record<string, unknown>>(endpointRecordPath(stateRoot, meshId, expected.endpointId));
    return Boolean(raw && raw.schemaVersion === 2 && raw.meshId === meshId && raw.endpointId === expected.endpointId && raw.online === true && raw.sessionFile === expected.endpointSessionFile && (expected.bindingId === undefined || raw.bindingId === expected.bindingId));
}

/** Caller must hold the mesh lock when this guards a mutation. */
export async function assertExpectedEndpointBindingUnlocked(stateRoot: string, meshId: string, expected: ExpectedEndpointBinding): Promise<void> {
    if (!await hasExpectedEndpointBindingUnlocked(stateRoot, meshId, expected)) throw new Error("Mesh caller endpoint/session binding is stale or offline");
}

export async function assertExpectedEndpointBinding(stateRoot: string, meshId: string, expected: ExpectedEndpointBinding): Promise<void> {
    await withMeshLock(stateRoot, meshId, () => assertExpectedEndpointBindingUnlocked(stateRoot, meshId, expected));
}
