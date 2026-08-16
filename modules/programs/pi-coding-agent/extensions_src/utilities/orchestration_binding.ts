import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { meshDirectory, withMeshLock } from "./orchestration_lock.ts";

export interface ExpectedEndpointBinding { endpointId: string; endpointSessionFile: string; bindingId?: string }

function endpointPath(stateRoot: string, meshId: string, endpointId: string): string {
    const key = createHash("sha256").update(endpointId).digest("hex");
    return join(meshDirectory(stateRoot, meshId), "endpoints", `${key}.json`);
}

export async function hasExpectedEndpointBindingUnlocked(stateRoot: string, meshId: string, expected: ExpectedEndpointBinding): Promise<boolean> {
    let raw: Record<string, unknown> | undefined;
    try { raw = JSON.parse(await readFile(endpointPath(stateRoot, meshId, expected.endpointId), "utf8")) as Record<string, unknown>; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return Boolean(raw && raw.schemaVersion === 2 && raw.meshId === meshId && raw.endpointId === expected.endpointId && raw.online === true && raw.sessionFile === expected.endpointSessionFile && (expected.bindingId === undefined || raw.bindingId === expected.bindingId));
}

/** Caller must hold the mesh lock when this guards a mutation. */
export async function assertExpectedEndpointBindingUnlocked(stateRoot: string, meshId: string, expected: ExpectedEndpointBinding): Promise<void> {
    if (!await hasExpectedEndpointBindingUnlocked(stateRoot, meshId, expected)) throw new Error("Mesh caller endpoint/session binding is stale or offline");
}

export async function assertExpectedEndpointBinding(stateRoot: string, meshId: string, expected: ExpectedEndpointBinding): Promise<void> {
    await withMeshLock(stateRoot, meshId, () => assertExpectedEndpointBindingUnlocked(stateRoot, meshId, expected));
}
