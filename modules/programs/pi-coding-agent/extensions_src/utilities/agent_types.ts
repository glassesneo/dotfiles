import { createHash } from "node:crypto";
import type { ExecutionProfile, ExecutionProfileConfig, ThinkingLevel } from "./mode_types.ts";

export type AgentHarness = "pi" | "cursor-agent" | "codex";
export type ContextPolicy = "project" | "prompt-only";
export interface RoleDefinition {
    description: string;
    tools: string[];
    skillOptIns: string[];
    instructions: string;
    defaultProfile: string;
    contextPolicy: ContextPolicy;
    childExtensionContributions: string[];
}
/** Temporary type alias so separately integrated runtime changes can migrate mechanically. */
export type AgentDefinition = RoleDefinition;
export interface RoleCatalog { schemaVersion: 2; roles: Record<string, RoleDefinition> }
/** Temporary type alias; the generated file and validator are role-catalog v2 only. */
export type AgentCatalog = RoleCatalog;
export interface CallerPolicy { roles: string[]; profiles: string[] }
export interface CallPolicy { modes: Record<string, { roles: string[] }>; roles: Record<string, CallerPolicy> }
export interface MeshBudgets { maxLiveAgents: number; maxConcurrentTasks: number; maxTasksPerMesh: number }
export interface RoleGcPolicy { collectAt: number; retain: number; pressureFloor: number }
export interface MeshGcConfig { contextHeadroomTokens: number; periodicIntervalMs: number; activityHeartbeatMs: number; activityStaleMs: number; roles: Record<string, RoleGcPolicy> }
export interface HarnessRuntimeConfig { adapter: "pi-native" | "cursor-acp" | "codex-acp"; command: string; workerCommand?: string; workerEntrypoint?: string; bridgeReadyTimeoutMs?: number }
export interface OrchestrationConfig { schemaVersion: 3; stateRoot: string; tmux: string; returnParentCommand: string; parentNavigationHint: string; historyViewerExtension: string; popupExtension: string; orchestrationExtension: string; childBridgeExtension: string; harnesses: Record<string, HarnessRuntimeConfig>; natureHandleWords: string[]; callPolicy: CallPolicy; budgets: MeshBudgets; gc: MeshGcConfig }
export interface PolicySnapshot {
    mode: string;
    directRoles: string[];
    roles: Record<string, RoleDefinition>;
    profiles: Record<string, ExecutionProfile>;
    policies: Record<string, CallerPolicy>;
}
export interface AgentLaunchEnvelope {
    schemaVersion: 2;
    marker: "pi-mesh-role-launch-v2";
    meshId: string;
    agentId: string;
    epochId: string;
    role: string;
    selectedProfile: string;
    selfRole: RoleDefinition;
    executionProfile: ExecutionProfile;
    roles: Record<string, RoleDefinition>;
    profiles: Record<string, ExecutionProfile>;
    policies: Record<string, CallerPolicy>;
    policyDigest: string;
    childExtensions: Record<string, string[]>;
    /** Transitional in-memory aliases; never serialized or accepted by the v2 decoder. */
    readonly identity: string;
    readonly self: RoleDefinition;
    readonly catalog: Record<string, RoleDefinition>;
    readonly roleSet: string[];
}

export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
    return JSON.stringify(value);
}
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void { const allowed = [...required, ...optional]; const unknown = Object.keys(value).filter(key => !allowed.includes(key)); const missing = required.filter(key => !(key in value)); if (unknown.length) throw new Error(`${label} contains unknown keys: ${unknown.join(", ")}`); if (missing.length) throw new Error(`${label} is missing required keys: ${missing.join(", ")}`); }
function text(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value; }
function strings(value: unknown, label: string): string[] { if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) throw new Error(`${label} must be an array of non-empty strings`); const result = [...value] as string[]; if (new Set(result).size !== result.length) throw new Error(`${label} must not contain duplicates`); return result; }
function positive(value: unknown, label: string): number { if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive integer`); return Number(value); }
function nonnegative(value: unknown, label: string): number { if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative integer`); return Number(value); }
function uuid(value: unknown, label: string): string { const result = text(value, label); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(result)) throw new Error(`${label} must be a UUID`); return result; }
function model(value: unknown, label: string): string { const result = text(value, label); if (!/^[^/\s]+\/[^/\s]+$/u.test(result)) throw new Error(`${label} must use provider/model format`); return result; }
const thinkingLevels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function validateExecutionProfile(name: string, value: unknown, label = `profiles.${name}`): ExecutionProfile {
    const raw = object(value, label); exact(raw, ["model", "harness"], ["thinkingLevel", "harnessOptions"], label);
    if (raw.harness !== "pi" && raw.harness !== "cursor-agent" && raw.harness !== "codex") throw new Error(`${label}.harness is invalid`);
    if (raw.thinkingLevel !== undefined && (typeof raw.thinkingLevel !== "string" || !thinkingLevels.has(raw.thinkingLevel))) throw new Error(`${label}.thinkingLevel is invalid`);
    const profile: ExecutionProfile = { model: model(raw.model, `${label}.model`), harness: raw.harness, ...(raw.thinkingLevel === undefined ? {} : { thinkingLevel: raw.thinkingLevel as ThinkingLevel }), ...(raw.harnessOptions === undefined ? {} : { harnessOptions: object(raw.harnessOptions, `${label}.harnessOptions`) }) };
    if (profile.harness === "pi" && (!profile.thinkingLevel || profile.harnessOptions)) throw new Error(`${label} Pi profile requires thinkingLevel and no harnessOptions`);
    if (profile.harness === "cursor-agent" && (!profile.model.startsWith("cursor/") || profile.thinkingLevel || !profile.harnessOptions)) throw new Error(`${label} Cursor profile is incompatible`);
    if (profile.harness === "codex" && (!profile.model.startsWith("codex/") || !profile.thinkingLevel || !profile.harnessOptions)) throw new Error(`${label} Codex profile is incompatible`);
    return profile;
}
export function validateExecutionProfileConfig(value: unknown): ExecutionProfileConfig {
    const root = object(value, "execution profiles"); exact(root, ["schemaVersion", "profiles"], [], "execution profiles"); if (root.schemaVersion !== 1) throw new Error("Unsupported execution profiles schemaVersion");
    const profiles = Object.fromEntries(Object.entries(object(root.profiles, "profiles")).map(([name, profile]) => [text(name, "profile name"), validateExecutionProfile(name, profile)]));
    return { schemaVersion: 1, profiles };
}
export const validateExecutionProfiles = validateExecutionProfileConfig;

export function validateRoleDefinition(name: string, value: unknown, label = `roles.${name}`): RoleDefinition {
    const raw = object(value, label); exact(raw, ["description", "tools", "skillOptIns", "instructions", "defaultProfile", "contextPolicy", "childExtensionContributions"], [], label);
    if (raw.contextPolicy !== "project" && raw.contextPolicy !== "prompt-only") throw new Error(`${label}.contextPolicy is invalid`);
    return { description: text(raw.description, `${label}.description`), tools: strings(raw.tools, `${label}.tools`), skillOptIns: strings(raw.skillOptIns, `${label}.skillOptIns`), instructions: text(raw.instructions, `${label}.instructions`), defaultProfile: text(raw.defaultProfile, `${label}.defaultProfile`), contextPolicy: raw.contextPolicy, childExtensionContributions: strings(raw.childExtensionContributions, `${label}.childExtensionContributions`) };
}
export const validateAgentDefinition = validateRoleDefinition;
export const validateAgentDefinitionSnapshot = validateRoleDefinition;
export function validateRoleCatalog(value: unknown): RoleCatalog {
    const root = object(value, "role catalog"); exact(root, ["schemaVersion", "roles"], [], "role catalog"); if (root.schemaVersion !== 2) throw new Error("Unsupported role catalog schemaVersion");
    return { schemaVersion: 2, roles: Object.fromEntries(Object.entries(object(root.roles, "roles")).map(([name, role]) => [text(name, "role name"), validateRoleDefinition(name, role)])) };
}
export const validateAgentCatalog = validateRoleCatalog;

function validateCallerPolicy(value: unknown, label: string): CallerPolicy { const raw = object(value, label); exact(raw, [], ["roles", "profiles"], label); return { roles: raw.roles === undefined ? [] : strings(raw.roles, `${label}.roles`), profiles: raw.profiles === undefined ? [] : strings(raw.profiles, `${label}.profiles`) }; }
function validateCallPolicy(value: unknown): CallPolicy {
    const raw = object(value, "callPolicy"); exact(raw, ["modes", "roles"], [], "callPolicy");
    const modes = Object.fromEntries(Object.entries(object(raw.modes, "callPolicy.modes")).map(([name, item]) => { const policy = object(item, `callPolicy.modes.${name}`); exact(policy, ["roles"], [], `callPolicy.modes.${name}`); return [name, { roles: strings(policy.roles, `callPolicy.modes.${name}.roles`) }]; }));
    const roles = Object.fromEntries(Object.entries(object(raw.roles, "callPolicy.roles")).map(([name, item]) => [name, validateCallerPolicy(item, `callPolicy.roles.${name}`)]));
    return { modes, roles };
}
export function validateOrchestrationConfig(value: unknown): OrchestrationConfig {
    const root = object(value, "orchestration config"); exact(root, ["schemaVersion", "stateRoot", "tmux", "returnParentCommand", "parentNavigationHint", "historyViewerExtension", "popupExtension", "orchestrationExtension", "childBridgeExtension", "harnesses", "natureHandleWords", "callPolicy", "budgets", "gc"], [], "orchestration config"); if (root.schemaVersion !== 3) throw new Error("Unsupported orchestration config schemaVersion");
    const harnesses: Record<string, HarnessRuntimeConfig> = {};
    for (const [name, itemValue] of Object.entries(object(root.harnesses, "harnesses"))) { const item = object(itemValue, `harnesses.${name}`); exact(item, ["adapter", "command"], ["workerCommand", "workerEntrypoint", "bridgeReadyTimeoutMs"], `harnesses.${name}`); if (item.adapter !== "pi-native" && item.adapter !== "cursor-acp" && item.adapter !== "codex-acp") throw new Error(`harnesses.${name}.adapter is invalid`); harnesses[name] = { adapter: item.adapter, command: text(item.command, `harnesses.${name}.command`), ...(item.workerCommand === undefined ? {} : { workerCommand: text(item.workerCommand, `harnesses.${name}.workerCommand`) }), ...(item.workerEntrypoint === undefined ? {} : { workerEntrypoint: text(item.workerEntrypoint, `harnesses.${name}.workerEntrypoint`) }), ...(item.bridgeReadyTimeoutMs === undefined ? {} : { bridgeReadyTimeoutMs: positive(item.bridgeReadyTimeoutMs, `harnesses.${name}.bridgeReadyTimeoutMs`) }) }; }
    const budgetRaw = object(root.budgets, "budgets"); exact(budgetRaw, ["maxLiveAgents", "maxConcurrentTasks", "maxTasksPerMesh"], [], "budgets"); const budgets = { maxLiveAgents: positive(budgetRaw.maxLiveAgents, "budgets.maxLiveAgents"), maxConcurrentTasks: positive(budgetRaw.maxConcurrentTasks, "budgets.maxConcurrentTasks"), maxTasksPerMesh: positive(budgetRaw.maxTasksPerMesh, "budgets.maxTasksPerMesh") }; if (budgets.maxConcurrentTasks > budgets.maxTasksPerMesh) throw new Error("maxConcurrentTasks must not exceed maxTasksPerMesh");
    const gcRaw = object(root.gc, "gc"); exact(gcRaw, ["contextHeadroomTokens", "periodicIntervalMs", "activityHeartbeatMs", "activityStaleMs", "roles"], [], "gc"); const roles = Object.fromEntries(Object.entries(object(gcRaw.roles, "gc.roles")).map(([name, itemValue]) => { const item = object(itemValue, `gc.roles.${name}`); exact(item, ["collectAt", "retain", "pressureFloor"], [], `gc.roles.${name}`); const policy = { collectAt: positive(item.collectAt, `gc.roles.${name}.collectAt`), retain: nonnegative(item.retain, `gc.roles.${name}.retain`), pressureFloor: nonnegative(item.pressureFloor, `gc.roles.${name}.pressureFloor`) }; if (policy.collectAt < policy.retain || policy.retain < policy.pressureFloor) throw new Error(`gc.roles.${name} hysteresis is invalid`); return [name, policy]; }));
    const gc = { contextHeadroomTokens: positive(gcRaw.contextHeadroomTokens, "gc.contextHeadroomTokens"), periodicIntervalMs: positive(gcRaw.periodicIntervalMs, "gc.periodicIntervalMs"), activityHeartbeatMs: positive(gcRaw.activityHeartbeatMs, "gc.activityHeartbeatMs"), activityStaleMs: positive(gcRaw.activityStaleMs, "gc.activityStaleMs"), roles }; if (gc.activityStaleMs <= gc.activityHeartbeatMs) throw new Error("activityStaleMs must exceed activityHeartbeatMs");
    return { schemaVersion: 3, stateRoot: text(root.stateRoot, "stateRoot"), tmux: text(root.tmux, "tmux"), returnParentCommand: text(root.returnParentCommand, "returnParentCommand"), parentNavigationHint: text(root.parentNavigationHint, "parentNavigationHint"), historyViewerExtension: text(root.historyViewerExtension, "historyViewerExtension"), popupExtension: text(root.popupExtension, "popupExtension"), orchestrationExtension: text(root.orchestrationExtension, "orchestrationExtension"), childBridgeExtension: text(root.childBridgeExtension, "childBridgeExtension"), harnesses, natureHandleWords: strings(root.natureHandleWords, "natureHandleWords"), callPolicy: validateCallPolicy(root.callPolicy), budgets, gc };
}
export const validateDelegationConfig = validateOrchestrationConfig;

export function validateOrchestrationReferences(config: OrchestrationConfig, catalog: RoleCatalog, profiles: ExecutionProfileConfig, modeNames?: readonly string[]): void {
    const knownRoles = new Set(Object.keys(catalog.roles));
    const knownProfiles = new Set(Object.keys(profiles.profiles));
    const knownModes = modeNames === undefined ? undefined : new Set(modeNames);
    for (const [mode, policy] of Object.entries(config.callPolicy.modes)) {
        if (knownModes && !knownModes.has(mode)) throw new Error(`callPolicy references unknown mode caller: ${mode}`);
        const unknown = policy.roles.filter(role => !knownRoles.has(role));
        if (unknown.length) throw new Error(`callPolicy.modes.${mode}.roles references unknown roles: ${unknown.join(", ")}`);
    }
    for (const [caller, policy] of Object.entries(config.callPolicy.roles)) {
        const role = catalog.roles[caller];
        if (!role) throw new Error(`callPolicy references unknown role caller: ${caller}`);
        const unknownRoles = policy.roles.filter(target => !knownRoles.has(target));
        if (unknownRoles.length) throw new Error(`callPolicy.roles.${caller}.roles references unknown roles: ${unknownRoles.join(", ")}`);
        const unknownProfiles = policy.profiles.filter(profile => !knownProfiles.has(profile));
        if (unknownProfiles.length) throw new Error(`callPolicy.roles.${caller}.profiles references unknown profiles: ${unknownProfiles.join(", ")}`);
        const defaultProfile = profiles.profiles[role.defaultProfile];
        if (!defaultProfile) throw new Error(`roles.${caller}.defaultProfile references unknown profile: ${role.defaultProfile}`);
        if (policy.profiles.includes(role.defaultProfile)) throw new Error(`callPolicy.roles.${caller}.profiles repeats its default profile`);
        const hasOutbound = policy.roles.length > 0 || policy.profiles.length > 0;
        if (hasOutbound && defaultProfile.harness !== "pi") throw new Error(`external-profile caller ${caller} cannot have outbound edges`);
        if (hasOutbound && role.contextPolicy === "prompt-only") throw new Error(`prompt-only caller ${caller} cannot have outbound edges`);
        if (role.contextPolicy === "prompt-only") {
            for (const profileName of [role.defaultProfile, ...policy.profiles]) if (profiles.profiles[profileName]?.harness !== "pi") throw new Error(`prompt-only role ${caller} may use only Pi profiles`);
        }
    }
    for (const [name, role] of Object.entries(catalog.roles)) {
        if (!knownProfiles.has(role.defaultProfile)) throw new Error(`roles.${name}.defaultProfile references unknown profile: ${role.defaultProfile}`);
        if (role.contextPolicy === "prompt-only" && profiles.profiles[role.defaultProfile]?.harness !== "pi") throw new Error(`prompt-only role ${name} may use only a Pi default profile`);
    }
}

function closureFrom(seeds: readonly string[], catalog: RoleCatalog, callPolicy: CallPolicy): string[] {
    const seen = new Set<string>(); const pending = [...seeds];
    while (pending.length) { const role = pending.shift()!; if (seen.has(role)) continue; if (!catalog.roles[role]) throw new Error(`call policy references unknown role: ${role}`); seen.add(role); for (const target of callPolicy.roles[role]?.roles ?? []) pending.push(target); }
    return [...seen];
}
export function buildPolicySnapshot(input: { mode: string; catalog: RoleCatalog; profiles: ExecutionProfileConfig; callPolicy: CallPolicy }): PolicySnapshot {
    const directRoles = input.callPolicy.modes[input.mode]?.roles ?? [];
    const names = closureFrom(directRoles, input.catalog, input.callPolicy); const roles = Object.fromEntries(names.map(name => [name, structuredClone(input.catalog.roles[name]!) ]));
    const policies = Object.fromEntries(names.map(name => [name, structuredClone(input.callPolicy.roles[name] ?? { roles: [], profiles: [] })]));
    const profileNames = new Set<string>(); for (const name of names) { profileNames.add(roles[name]!.defaultProfile); for (const profile of policies[name]!.profiles) profileNames.add(profile); }
    const profiles = Object.fromEntries([...profileNames].map(name => { const profile = input.profiles.profiles[name]; if (!profile) throw new Error(`policy references unknown profile: ${name}`); return [name, structuredClone(profile)]; }));
    return { mode: input.mode, directRoles: [...directRoles], roles, profiles, policies };
}
export function policyDigest(input: PolicySnapshot): string {
    const snapshot: PolicySnapshot = { mode: input.mode, directRoles: [...input.directRoles], roles: input.roles, profiles: input.profiles, policies: input.policies };
    return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}
export function projectPolicyClosure(role: string, snapshot: PolicySnapshot): PolicySnapshot {
    const catalog: RoleCatalog = { schemaVersion: 2, roles: snapshot.roles }; const callPolicy: CallPolicy = { modes: { child: { roles: [role] } }, roles: snapshot.policies }; const names = closureFrom([role], catalog, callPolicy);
    const roles = Object.fromEntries(names.map(name => [name, structuredClone(snapshot.roles[name]!) ])); const policies = Object.fromEntries(names.map(name => [name, structuredClone(snapshot.policies[name] ?? { roles: [], profiles: [] })]));
    const profileNames = new Set<string>(); for (const name of names) { profileNames.add(roles[name]!.defaultProfile); for (const profile of policies[name]!.profiles) profileNames.add(profile); }
    return { mode: snapshot.mode, directRoles: [role], roles, profiles: Object.fromEntries([...profileNames].map(name => [name, structuredClone(snapshot.profiles[name]!)])), policies };
}
export function validateLaunchEnvelope(value: unknown): AgentLaunchEnvelope {
    const root = object(value, "agent launch envelope"); exact(root, ["schemaVersion", "marker", "meshId", "agentId", "epochId", "role", "selectedProfile", "selfRole", "executionProfile", "roles", "profiles", "policies", "policyDigest", "childExtensions"], [], "agent launch envelope"); if (root.schemaVersion !== 2 || root.marker !== "pi-mesh-role-launch-v2") throw new Error("Unsupported agent launch envelope schema or marker");
    const role = text(root.role, "role"); const roles = Object.fromEntries(Object.entries(object(root.roles, "roles")).map(([name, definition]) => [name, validateRoleDefinition(name, definition)])); if (!roles[role]) throw new Error("launch closure must contain role");
    const profiles = Object.fromEntries(Object.entries(object(root.profiles, "profiles")).map(([name, profile]) => [name, validateExecutionProfile(name, profile)])); const selectedProfile = text(root.selectedProfile, "selectedProfile"); const executionProfile = validateExecutionProfile(selectedProfile, root.executionProfile, "executionProfile"); if (canonicalJson(profiles[selectedProfile]) !== canonicalJson(executionProfile)) throw new Error("executionProfile does not match selectedProfile");
    const selfRole = validateRoleDefinition(role, root.selfRole, "selfRole"); if (canonicalJson(roles[role]) !== canonicalJson(selfRole)) throw new Error("selfRole does not match closure role");
    const policies = Object.fromEntries(Object.entries(object(root.policies, "policies")).map(([name, policy]) => [name, validateCallerPolicy(policy, `policies.${name}`)])); if (canonicalJson(Object.keys(policies).sort()) !== canonicalJson(Object.keys(roles).sort())) throw new Error("policies must exactly cover closure roles");
    for (const [name, definition] of Object.entries(roles)) {
        const defaultProfile = profiles[definition.defaultProfile];
        if (!defaultProfile) throw new Error(`roles.${name}.defaultProfile is outside profiles closure`);
        const policy = policies[name]!;
        const outsideRoles = policy.roles.filter(target => !roles[target]);
        if (outsideRoles.length) throw new Error(`policies.${name}.roles target outside roles closure: ${outsideRoles.join(", ")}`);
        const outsideProfiles = policy.profiles.filter(profile => !profiles[profile]);
        if (outsideProfiles.length) throw new Error(`policies.${name}.profiles target outside profiles closure: ${outsideProfiles.join(", ")}`);
        if ((policy.roles.length || policy.profiles.length) && defaultProfile.harness !== "pi") throw new Error(`external profile caller ${name} cannot have outbound policy`);
        if ((policy.roles.length || policy.profiles.length) && definition.contextPolicy === "prompt-only") throw new Error(`prompt-only caller ${name} cannot have outbound policy`);
    }
    const allowedSelectedProfiles = new Set([selfRole.defaultProfile, ...policies[role]!.profiles]);
    if (!allowedSelectedProfiles.has(selectedProfile)) throw new Error(`selectedProfile ${selectedProfile} is not authorized for role ${role}`);
    const childExtensions = Object.fromEntries(Object.entries(object(root.childExtensions, "childExtensions")).map(([name, paths]) => [name, strings(paths, `childExtensions.${name}`)])); if (canonicalJson(Object.keys(childExtensions).sort()) !== canonicalJson(Object.keys(roles).sort())) throw new Error("childExtensions must exactly cover closure roles");
    const digest = text(root.policyDigest, "policyDigest"); if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error("policyDigest must be SHA-256");
    const envelope = { schemaVersion: 2, marker: "pi-mesh-role-launch-v2", meshId: uuid(root.meshId, "meshId"), agentId: uuid(root.agentId, "agentId"), epochId: uuid(root.epochId, "epochId"), role, selectedProfile, selfRole, executionProfile, roles, profiles, policies, policyDigest: digest, childExtensions } as AgentLaunchEnvelope;
    Object.defineProperties(envelope, {
        identity: { enumerable: false, value: `agent:${role}` },
        self: { enumerable: false, value: selfRole },
        catalog: { enumerable: false, value: roles },
        roleSet: { enumerable: false, value: Object.keys(roles) },
    });
    return envelope;
}
export function launchEnvelopeDigest(envelope: AgentLaunchEnvelope): string { return createHash("sha256").update(canonicalJson(validateLaunchEnvelope(envelope))).digest("hex"); }
export function assertLaunchEnvelopeProjection(envelopeValue: unknown, epoch: PolicySnapshot): AgentLaunchEnvelope {
    const envelope = validateLaunchEnvelope(envelopeValue);
    const expected = projectPolicyClosure(envelope.role, epoch);
    if (envelope.policyDigest !== policyDigest(epoch)
        || canonicalJson(envelope.roles) !== canonicalJson(expected.roles)
        || canonicalJson(envelope.profiles) !== canonicalJson(expected.profiles)
        || canonicalJson(envelope.policies) !== canonicalJson(expected.policies)) throw new Error("launch envelope is not the exact child projection of its policy epoch");
    return envelope;
}
export function buildLaunchEnvelope(input: { meshId: string; agentId: string; epochId: string; role: string; selectedProfile?: string; snapshot: PolicySnapshot; childExtensions: Record<string, string[]> }): AgentLaunchEnvelope {
    const closure = projectPolicyClosure(input.role, input.snapshot); const selectedProfile = input.selectedProfile ?? closure.roles[input.role]?.defaultProfile; if (!selectedProfile || !closure.profiles[selectedProfile]) throw new Error(`Selected profile ${String(selectedProfile)} is outside role closure`);
    const extensions = Object.fromEntries(Object.keys(closure.roles).map(name => { const paths = input.childExtensions[name]; if (!paths) throw new Error(`Missing child extension manifest for ${name}`); return [name, paths]; }));
    return validateLaunchEnvelope({ schemaVersion: 2, marker: "pi-mesh-role-launch-v2", meshId: input.meshId, agentId: input.agentId, epochId: input.epochId, role: input.role, selectedProfile, selfRole: closure.roles[input.role], executionProfile: closure.profiles[selectedProfile], roles: closure.roles, profiles: closure.profiles, policies: closure.policies, policyDigest: policyDigest(input.snapshot), childExtensions: extensions });
}
export function projectLaunchEnvelope(role: string, agentId: string, parent: AgentLaunchEnvelope, selectedProfile?: string): AgentLaunchEnvelope {
    const source = validateLaunchEnvelope(parent); const snapshot: PolicySnapshot = { mode: "child", directRoles: [source.role], roles: source.roles, profiles: source.profiles, policies: source.policies }; const allowed = source.policies[source.role]?.roles ?? []; if (!allowed.includes(role)) throw new Error(`Role ${role} is outside caller direct policy`);
    const projected = buildLaunchEnvelope({ meshId: source.meshId, agentId, epochId: source.epochId, role, selectedProfile, snapshot, childExtensions: source.childExtensions });
    return validateLaunchEnvelope({ ...projected, policyDigest: source.policyDigest });
}
