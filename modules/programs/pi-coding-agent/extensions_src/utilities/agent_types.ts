import { createHash } from "node:crypto";
import { validateExecutionProfile as validateProfile, validateExecutionProfileConfig as validateProfileConfig, type ExecutionProfile, type ExecutionProfileConfig } from "./mode_types.ts";

export type AgentHarness = "pi" | "cursor-agent" | "codex";
export type ContextPolicy = "project" | "prompt-only";
export type CapabilityAccess = "read" | "write";
export interface RoleSelector { agent: string; access: CapabilityAccess }
export interface RoleDefinition {
    selector: RoleSelector;
    description: string;
    tools: string[];
    instructions: string;
    contextPolicy: ContextPolicy;
    childExtensionContributions: string[];
}
export type AgentDefinition = RoleDefinition;
export interface RoleCatalog { schemaVersion: 6; roles: Record<string, RoleDefinition> }
export type AgentCatalog = RoleCatalog;
export interface TargetPolicy { profiles: string[] }
export interface CallerPolicy { targets: Record<string, TargetPolicy> }
export interface CallPolicy { modes: Record<string, CallerPolicy>; roles: Record<string, CallerPolicy> }
export interface MeshBudgets { maxLiveAgents: number; maxConcurrentTasks: number; maxTasksPerMesh: number }
export interface RoleGcPolicy { collectAt: number; retain: number; pressureFloor: number }
export interface MeshGcConfig { contextHeadroomTokens: number; periodicIntervalMs: number; activityHeartbeatMs: number; activityStaleMs: number; roles: Record<string, RoleGcPolicy> }
export interface HarnessRuntimeConfig { adapter: "pi-native" | "cursor-acp" | "codex-acp"; command: string; workerCommand?: string; workerEntrypoint?: string; bridgeReadyTimeoutMs?: number; modelIds?: Record<string, string> }
export interface OrchestrationConfig { schemaVersion: 5; stateRoot: string; tmux: string; returnParentCommand: string; parentNavigationHint: string; historyViewerExtension: string; popupExtension: string; orchestrationExtension: string; childBridgeExtension: string; harnesses: Record<string, HarnessRuntimeConfig>; natureHandleWords: string[]; callPolicy: CallPolicy; budgets: MeshBudgets; gc: MeshGcConfig }
export interface PolicySnapshot {
    mode: string;
    directTargets: Record<string, TargetPolicy>;
    roles: Record<string, RoleDefinition>;
    profiles: Record<string, ExecutionProfile>;
    policies: Record<string, CallerPolicy>;
}
export const LAUNCH_ENVELOPE_SCHEMA_VERSION = 7 as const;
export const LAUNCH_ENVELOPE_MARKER = "pi-mesh-role-launch-v7";
export interface AgentLaunchEnvelope {
    schemaVersion: 7;
    marker: "pi-mesh-role-launch-v7";
    meshId: string;
    agentId: string;
    epochId: string;
    role: string;
    selectedProfile: string;
    initialCandidateIndex: number;
    selfRole: RoleDefinition;
    executionProfile: ExecutionProfile;
    directTargets: Record<string, TargetPolicy>;
    roles: Record<string, RoleDefinition>;
    profiles: Record<string, ExecutionProfile>;
    policies: Record<string, CallerPolicy>;
    policyDigest: string;
    childExtensions: Record<string, string[]>;
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
export function validateExecutionProfile(name: string, value: unknown, label = `profiles.${name}`): ExecutionProfile {
    return validateProfile(name, value, label);
}
export function validateExecutionProfileConfig(value: unknown): ExecutionProfileConfig {
    return validateProfileConfig(value);
}
export const validateExecutionProfiles = validateExecutionProfileConfig;

export function validateRoleDefinition(name: string, value: unknown, label = `roles.${name}`): RoleDefinition {
    const raw = object(value, label); exact(raw, ["selector", "description", "tools", "instructions", "contextPolicy", "childExtensionContributions"], [], label);
    const selectorRaw = object(raw.selector, `${label}.selector`); exact(selectorRaw, ["agent", "access"], [], `${label}.selector`);
    if (selectorRaw.access !== "read" && selectorRaw.access !== "write") throw new Error(`${label}.selector.access is invalid`);
    const selector: RoleSelector = { agent: text(selectorRaw.agent, `${label}.selector.agent`), access: selectorRaw.access };
    if (raw.contextPolicy !== "project" && raw.contextPolicy !== "prompt-only") throw new Error(`${label}.contextPolicy is invalid`);
    return { selector, description: text(raw.description, `${label}.description`), tools: strings(raw.tools, `${label}.tools`), instructions: text(raw.instructions, `${label}.instructions`), contextPolicy: raw.contextPolicy, childExtensionContributions: strings(raw.childExtensionContributions, `${label}.childExtensionContributions`) };
}
export const validateAgentDefinition = validateRoleDefinition;
export const validateAgentDefinitionSnapshot = validateRoleDefinition;
export function validateRoleCatalog(value: unknown): RoleCatalog {
    const root = object(value, "role catalog"); exact(root, ["schemaVersion", "roles"], [], "role catalog"); if (root.schemaVersion !== 6) throw new Error("Unsupported role catalog schemaVersion");
    return { schemaVersion: 6, roles: Object.fromEntries(Object.entries(object(root.roles, "roles")).map(([name, role]) => [text(name, "role name"), validateRoleDefinition(name, role)])) };
}
export const validateAgentCatalog = validateRoleCatalog;

export function validateTargetPolicy(value: unknown, label: string): TargetPolicy { const raw = object(value, label); exact(raw, ["profiles"], [], label); const profiles = strings(raw.profiles, `${label}.profiles`); if (profiles.length !== 1) throw new Error(`${label}.profiles must contain exactly one profile`); return { profiles }; }
export function validateCallerPolicy(value: unknown, label: string): CallerPolicy { const raw = object(value, label); exact(raw, ["targets"], [], label); return { targets: Object.fromEntries(Object.entries(object(raw.targets, `${label}.targets`)).map(([name, target]) => [text(name, `${label} target name`), validateTargetPolicy(target, `${label}.targets.${name}`)])) }; }
function validateCallPolicy(value: unknown): CallPolicy { const raw = object(value, "callPolicy"); exact(raw, ["modes", "roles"], [], "callPolicy"); return { modes: Object.fromEntries(Object.entries(object(raw.modes, "callPolicy.modes")).map(([name, policy]) => [name, validateCallerPolicy(policy, `callPolicy.modes.${name}`)])), roles: Object.fromEntries(Object.entries(object(raw.roles, "callPolicy.roles")).map(([name, policy]) => [name, validateCallerPolicy(policy, `callPolicy.roles.${name}`)])) }; }
export function validateOrchestrationConfig(value: unknown): OrchestrationConfig {
    const root = object(value, "orchestration config"); exact(root, ["schemaVersion", "stateRoot", "tmux", "returnParentCommand", "parentNavigationHint", "historyViewerExtension", "popupExtension", "orchestrationExtension", "childBridgeExtension", "harnesses", "natureHandleWords", "callPolicy", "budgets", "gc"], [], "orchestration config"); if (root.schemaVersion !== 5) throw new Error("Unsupported orchestration config schemaVersion");
    const harnesses: Record<string, HarnessRuntimeConfig> = {};
    for (const [name, itemValue] of Object.entries(object(root.harnesses, "harnesses"))) { const item = object(itemValue, `harnesses.${name}`); const cursor = item.adapter === "cursor-acp"; exact(item, ["adapter", "command", ...(cursor ? ["modelIds"] : [])], ["workerCommand", "workerEntrypoint", "bridgeReadyTimeoutMs"], `harnesses.${name}`); if (item.adapter !== "pi-native" && item.adapter !== "cursor-acp" && item.adapter !== "codex-acp") throw new Error(`harnesses.${name}.adapter is invalid`); const modelIds = cursor ? Object.fromEntries(Object.entries(object(item.modelIds, `harnesses.${name}.modelIds`)).map(([alias, modelId]) => [text(alias, `harnesses.${name}.modelIds alias`), text(modelId, `harnesses.${name}.modelIds.${alias}`)])) : undefined; harnesses[name] = { adapter: item.adapter, command: text(item.command, `harnesses.${name}.command`), ...(item.workerCommand === undefined ? {} : { workerCommand: text(item.workerCommand, `harnesses.${name}.workerCommand`) }), ...(item.workerEntrypoint === undefined ? {} : { workerEntrypoint: text(item.workerEntrypoint, `harnesses.${name}.workerEntrypoint`) }), ...(item.bridgeReadyTimeoutMs === undefined ? {} : { bridgeReadyTimeoutMs: positive(item.bridgeReadyTimeoutMs, `harnesses.${name}.bridgeReadyTimeoutMs`) }), ...(modelIds ? { modelIds } : {}) }; }
    const budgetRaw = object(root.budgets, "budgets"); exact(budgetRaw, ["maxLiveAgents", "maxConcurrentTasks", "maxTasksPerMesh"], [], "budgets"); const budgets = { maxLiveAgents: positive(budgetRaw.maxLiveAgents, "budgets.maxLiveAgents"), maxConcurrentTasks: positive(budgetRaw.maxConcurrentTasks, "budgets.maxConcurrentTasks"), maxTasksPerMesh: positive(budgetRaw.maxTasksPerMesh, "budgets.maxTasksPerMesh") }; if (budgets.maxConcurrentTasks > budgets.maxTasksPerMesh) throw new Error("maxConcurrentTasks must not exceed maxTasksPerMesh");
    const gcRaw = object(root.gc, "gc"); exact(gcRaw, ["contextHeadroomTokens", "periodicIntervalMs", "activityHeartbeatMs", "activityStaleMs", "roles"], [], "gc"); const roles = Object.fromEntries(Object.entries(object(gcRaw.roles, "gc.roles")).map(([name, itemValue]) => { const item = object(itemValue, `gc.roles.${name}`); exact(item, ["collectAt", "retain", "pressureFloor"], [], `gc.roles.${name}`); const policy = { collectAt: positive(item.collectAt, `gc.roles.${name}.collectAt`), retain: nonnegative(item.retain, `gc.roles.${name}.retain`), pressureFloor: nonnegative(item.pressureFloor, `gc.roles.${name}.pressureFloor`) }; if (policy.collectAt < policy.retain || policy.retain < policy.pressureFloor) throw new Error(`gc.roles.${name} hysteresis is invalid`); return [name, policy]; }));
    const gc = { contextHeadroomTokens: positive(gcRaw.contextHeadroomTokens, "gc.contextHeadroomTokens"), periodicIntervalMs: positive(gcRaw.periodicIntervalMs, "gc.periodicIntervalMs"), activityHeartbeatMs: positive(gcRaw.activityHeartbeatMs, "gc.activityHeartbeatMs"), activityStaleMs: positive(gcRaw.activityStaleMs, "gc.activityStaleMs"), roles }; if (gc.activityStaleMs <= gc.activityHeartbeatMs) throw new Error("activityStaleMs must exceed activityHeartbeatMs");
    return { schemaVersion: 5, stateRoot: text(root.stateRoot, "stateRoot"), tmux: text(root.tmux, "tmux"), returnParentCommand: text(root.returnParentCommand, "returnParentCommand"), parentNavigationHint: text(root.parentNavigationHint, "parentNavigationHint"), historyViewerExtension: text(root.historyViewerExtension, "historyViewerExtension"), popupExtension: text(root.popupExtension, "popupExtension"), orchestrationExtension: text(root.orchestrationExtension, "orchestrationExtension"), childBridgeExtension: text(root.childBridgeExtension, "childBridgeExtension"), harnesses, natureHandleWords: strings(root.natureHandleWords, "natureHandleWords"), callPolicy: validateCallPolicy(root.callPolicy), budgets, gc };
}
export const validateDelegationConfig = validateOrchestrationConfig;

export type AuthorizedSelector = { role: string; selector: RoleSelector; definition: RoleDefinition; profile: string };
function selectorKey(selector: RoleSelector): string { return `${selector.agent}\u0000${selector.access}`; }
export function resolveAuthorizedSelectors(policy: CallerPolicy, roles: Readonly<Record<string, RoleDefinition>>): AuthorizedSelector[] {
    const seen = new Map<string, string>();
    return Object.entries(policy.targets).map(([role, edge]) => {
        const definition = roles[role];
        if (!definition) throw new Error(`Authorized edge references unknown role ${role}`);
        if (edge.profiles.length !== 1) throw new Error(`Authorized edge ${role} must contain exactly one profile`);
        const key = selectorKey(definition.selector); const prior = seen.get(key);
        if (prior) throw new Error(`Authorized selectors ${prior} and ${role} are ambiguous`);
        seen.set(key, role);
        return { role, selector: structuredClone(definition.selector), definition, profile: edge.profiles[0]! };
    });
}

export function publicCapability(selector: RoleSelector): string {
    return `${selector.agent}/${selector.access}`;
}

function policyEdges(callPolicy: CallPolicy): Array<{ caller?: string; target: string; profiles: string[] }> { return [...Object.values(callPolicy.modes).flatMap(policy => Object.entries(policy.targets).map(([target, edge]) => ({ target, profiles: edge.profiles }))), ...Object.entries(callPolicy.roles).flatMap(([caller, policy]) => Object.entries(policy.targets).map(([target, edge]) => ({ caller, target, profiles: edge.profiles })))]; }
export function validateOrchestrationReferences(config: OrchestrationConfig, catalog: RoleCatalog, profiles: ExecutionProfileConfig, modeNames?: readonly string[]): void {
    const knownRoles = new Set(Object.keys(catalog.roles)); const knownProfiles = new Set(Object.keys(profiles.profiles)); const knownModes = modeNames === undefined ? undefined : new Set(modeNames);
    for (const mode of Object.keys(config.callPolicy.modes)) if (knownModes && !knownModes.has(mode)) throw new Error(`callPolicy references unknown mode caller: ${mode}`);
    for (const caller of Object.keys(config.callPolicy.roles)) if (!knownRoles.has(caller)) throw new Error(`callPolicy references unknown role caller: ${caller}`);
    const edges = policyEdges(config.callPolicy);
    for (const policy of [...Object.values(config.callPolicy.modes), ...Object.values(config.callPolicy.roles)]) resolveAuthorizedSelectors(policy, catalog.roles);
    for (const edge of edges) { if (!knownRoles.has(edge.target)) throw new Error(`callPolicy references unknown role target: ${edge.target}`); const unknown = edge.profiles.filter(profile => !knownProfiles.has(profile)); if (unknown.length) throw new Error(`callPolicy edge to ${edge.target} references unknown profiles: ${unknown.join(", ")}`); }
    for (const [name, profile] of Object.entries(profiles.profiles)) if (profile.harness === "cursor-agent") { const alias = profile.models[0]!.slice("cursor/".length); if (!config.harnesses[profile.harness]?.modelIds?.[alias]) throw new Error(`Cursor profile ${name} has no configured ACP model ID for ${alias}`); }
    for (const [mode, policy] of Object.entries(config.callPolicy.modes)) if (Object.keys(policy.targets).some(target => catalog.roles[target]?.selector.agent === "search")) throw new Error(`search capability cannot be a root target in mode ${mode}`);
    for (const [caller, policy] of Object.entries(config.callPolicy.roles)) if (caller !== "research" && Object.keys(policy.targets).some(target => catalog.roles[target]?.selector.agent === "search")) throw new Error(`search capability may only be targeted by research, not ${caller}`);
    const incoming = (role: string) => [...new Set(edges.filter(edge => edge.target === role).flatMap(edge => edge.profiles))];
    for (const [name, role] of Object.entries(catalog.roles)) {
        const outbound = config.callPolicy.roles[name]?.targets ?? {};
        if (Object.keys(outbound).length && incoming(name).some(profile => profiles.profiles[profile]?.harness !== "pi")) throw new Error(`external-profile caller ${name} cannot have outbound edges`);
        if (Object.keys(outbound).length && role.contextPolicy === "prompt-only") throw new Error(`prompt-only caller ${name} cannot have outbound edges`);
        if (role.contextPolicy === "prompt-only" && incoming(name).some(profile => profiles.profiles[profile]?.harness !== "pi")) throw new Error(`prompt-only role ${name} may use only Pi profiles`);
    }
}

function closureFrom(seeds: readonly string[], catalog: RoleCatalog, callPolicy: CallPolicy): string[] { const seen = new Set<string>(); const pending = [...seeds]; while (pending.length) { const role = pending.shift()!; if (seen.has(role)) continue; if (!catalog.roles[role]) throw new Error(`call policy references unknown role: ${role}`); seen.add(role); for (const target of Object.keys(callPolicy.roles[role]?.targets ?? {})) pending.push(target); } return [...seen]; }
function profilesFor(names: readonly string[], directTargets: Record<string, TargetPolicy>, policies: Record<string, CallerPolicy>): string[] { const result = new Set<string>(); for (const edge of Object.values(directTargets)) for (const profile of edge.profiles) result.add(profile); for (const name of names) for (const edge of Object.values(policies[name]?.targets ?? {})) for (const profile of edge.profiles) result.add(profile); return [...result]; }
export function buildPolicySnapshot(input: { mode: string; catalog: RoleCatalog; profiles: ExecutionProfileConfig; callPolicy: CallPolicy }): PolicySnapshot {
    const directTargets = structuredClone(input.callPolicy.modes[input.mode]?.targets ?? {}); const names = closureFrom(Object.keys(directTargets), input.catalog, input.callPolicy); const roles = Object.fromEntries(names.map(name => [name, structuredClone(input.catalog.roles[name]!) ])); const policies = Object.fromEntries(names.map(name => [name, structuredClone(input.callPolicy.roles[name] ?? { targets: {} })])); const profileNames = profilesFor(names, directTargets, policies); const selectedProfiles = Object.fromEntries(profileNames.map(name => { const profile = input.profiles.profiles[name]; if (!profile) throw new Error(`policy references unknown profile: ${name}`); return [name, structuredClone(profile)]; })); const snapshot = { mode: input.mode, directTargets, roles, profiles: selectedProfiles, policies }; validatePolicySnapshotReferences(snapshot, "root"); return snapshot;
}
export function policyDigest(input: PolicySnapshot): string { return createHash("sha256").update(canonicalJson({ mode: input.mode, directTargets: input.directTargets, roles: input.roles, profiles: input.profiles, policies: input.policies })).digest("hex"); }
export type PolicySnapshotScope = "root" | "child";
export function validatePolicySnapshotReferences(snapshot: PolicySnapshot, scope: PolicySnapshotScope): void {
    for (const [name, edge] of Object.entries(snapshot.directTargets)) {
        if (!snapshot.roles[name]) throw new Error(`Policy snapshot direct target ${name} is outside roles`);
        for (const profile of edge.profiles) if (!snapshot.profiles[profile]) throw new Error(`Policy snapshot direct target ${name} profile ${profile} is outside profiles`);
    }
    for (const [name, policy] of Object.entries(snapshot.policies)) {
        if (!snapshot.roles[name]) throw new Error(`Policy snapshot caller ${name} is outside roles`);
        resolveAuthorizedSelectors(policy, snapshot.roles);
        if (name !== "research" && Object.keys(policy.targets).some(target => snapshot.roles[target]?.selector.agent === "search")) throw new Error(`search capability may only be targeted by research, not ${name}`);
        for (const [target, edge] of Object.entries(policy.targets)) {
            if (!snapshot.roles[target]) throw new Error(`Policy snapshot ${name} target ${target} is outside roles`);
            for (const profile of edge.profiles) if (!snapshot.profiles[profile]) throw new Error(`Policy snapshot ${name} target ${target} profile ${profile} is outside profiles`);
        }
    }
    const inboundProfiles = (name: string) => [...(snapshot.directTargets[name]?.profiles ?? []), ...Object.values(snapshot.policies).flatMap(policy => Object.entries(policy.targets).filter(([target]) => target === name).flatMap(([, edge]) => edge.profiles))];
    if (scope === "root" && Object.keys(snapshot.directTargets).some(name => snapshot.roles[name]?.selector.agent === "search")) throw new Error("search capability cannot be a root target");
    for (const [name, definition] of Object.entries(snapshot.roles)) {
        const inbound = inboundProfiles(name);
        if (Object.keys(snapshot.policies[name]?.targets ?? {}).length && inbound.some(profile => snapshot.profiles[profile]?.harness !== "pi")) throw new Error(`external profile caller ${name} cannot have outbound policy`);
        if (Object.keys(snapshot.policies[name]?.targets ?? {}).length && definition.contextPolicy === "prompt-only") throw new Error(`Prompt-only caller ${name} cannot have outbound policy`);
        if (definition.contextPolicy === "prompt-only" && inbound.some(profile => snapshot.profiles[profile]?.harness !== "pi")) throw new Error(`Prompt-only role ${name} may use only Pi profiles`);
    }
}
export function projectPolicyClosure(role: string, snapshot: PolicySnapshot, authorizedProfiles?: readonly string[]): PolicySnapshot {
    validatePolicySnapshotReferences(snapshot, "child");
    const catalog: RoleCatalog = { schemaVersion: 6, roles: snapshot.roles }; const callPolicy: CallPolicy = { modes: {}, roles: snapshot.policies }; const names = closureFrom([role], catalog, callPolicy); const roles = Object.fromEntries(names.map(name => [name, structuredClone(snapshot.roles[name]!) ])); const policies = Object.fromEntries(names.map(name => [name, structuredClone(snapshot.policies[name] ?? { targets: {} })])); const profiles = [...(authorizedProfiles ?? snapshot.directTargets[role]?.profiles ?? [])]; if (!profiles.length) throw new Error(`Role ${role} has no authorized execution profiles`); const directTargets = { [role]: { profiles } }; const profileNames = profilesFor(names, directTargets, policies); const projected = { mode: snapshot.mode, directTargets, roles, profiles: Object.fromEntries(profileNames.map(name => { const profile = snapshot.profiles[name]; if (!profile) throw new Error(`Profile ${name} is outside policy snapshot`); return [name, structuredClone(profile)]; })), policies }; validatePolicySnapshotReferences(projected, "child"); return projected;
}
export function validateLaunchEnvelope(value: unknown): AgentLaunchEnvelope {
    const root = object(value, "agent launch envelope"); exact(root, ["schemaVersion", "marker", "meshId", "agentId", "epochId", "role", "selectedProfile", "initialCandidateIndex", "selfRole", "executionProfile", "directTargets", "roles", "profiles", "policies", "policyDigest", "childExtensions"], [], "agent launch envelope"); if (root.schemaVersion !== LAUNCH_ENVELOPE_SCHEMA_VERSION || root.marker !== LAUNCH_ENVELOPE_MARKER) throw new Error("Unsupported agent launch envelope schema or marker");
    const role = text(root.role, "role"); const roles = Object.fromEntries(Object.entries(object(root.roles, "roles")).map(([name, definition]) => [name, validateRoleDefinition(name, definition)])); if (!roles[role]) throw new Error("launch closure must contain role");
    const profiles = Object.fromEntries(Object.entries(object(root.profiles, "profiles")).map(([name, profile]) => [name, validateExecutionProfile(name, profile)])); const selectedProfile = text(root.selectedProfile, "selectedProfile"); const executionProfile = validateExecutionProfile(selectedProfile, root.executionProfile, "executionProfile"); if (canonicalJson(profiles[selectedProfile]) !== canonicalJson(executionProfile)) throw new Error("executionProfile does not match selectedProfile");
    const selfRole = validateRoleDefinition(role, root.selfRole, "selfRole"); if (canonicalJson(roles[role]) !== canonicalJson(selfRole)) throw new Error("selfRole does not match closure role");
    const directTargets = Object.fromEntries(Object.entries(object(root.directTargets, "directTargets")).map(([name, edge]) => [name, validateTargetPolicy(edge, `directTargets.${name}`)])); if (Object.keys(directTargets).length !== 1 || !directTargets[role]) throw new Error("launch directTargets must contain only the launched role"); if (!directTargets[role].profiles.includes(selectedProfile)) throw new Error(`selectedProfile ${selectedProfile} is not authorized for role ${role}`); for (const profile of directTargets[role].profiles) if (!profiles[profile]) throw new Error(`directTargets.${role} profile ${profile} is outside profiles closure`);
    const policies = Object.fromEntries(Object.entries(object(root.policies, "policies")).map(([name, policy]) => [name, validateCallerPolicy(policy, `policies.${name}`)])); if (canonicalJson(Object.keys(policies).sort()) !== canonicalJson(Object.keys(roles).sort())) throw new Error("policies must exactly cover closure roles");
    for (const policy of Object.values(policies)) resolveAuthorizedSelectors(policy, roles);
    validatePolicySnapshotReferences({ mode: "child", directTargets, roles, profiles, policies }, "child");
    for (const [name, definition] of Object.entries(roles)) {
        const policy = policies[name]!;
        for (const [target, edge] of Object.entries(policy.targets)) { if (!roles[target]) throw new Error(`policies.${name}.targets.${target} is outside roles closure`); for (const profile of edge.profiles) if (!profiles[profile]) throw new Error(`policies.${name}.targets.${target} profile ${profile} is outside profiles closure`); }
        const incomingProfiles = [...(name === role ? directTargets[role].profiles : []), ...Object.values(policies).flatMap(caller => Object.entries(caller.targets).filter(([target]) => target === name).flatMap(([, edge]) => edge.profiles))];
        if (Object.keys(policy.targets).length && incomingProfiles.some(profile => profiles[profile]?.harness !== "pi")) throw new Error(`external profile caller ${name} cannot have outbound policy`);
        if (Object.keys(policy.targets).length && definition.contextPolicy === "prompt-only") throw new Error(`prompt-only caller ${name} cannot have outbound policy`);
        if (definition.contextPolicy === "prompt-only" && incomingProfiles.some(profile => profiles[profile]?.harness !== "pi")) throw new Error(`prompt-only role ${name} may use only Pi profiles`);
    }
    const childExtensions = Object.fromEntries(Object.entries(object(root.childExtensions, "childExtensions")).map(([name, paths]) => [name, strings(paths, `childExtensions.${name}`)])); if (canonicalJson(Object.keys(childExtensions).sort()) !== canonicalJson(Object.keys(roles).sort())) throw new Error("childExtensions must exactly cover closure roles"); const digest = text(root.policyDigest, "policyDigest"); if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error("policyDigest must be SHA-256");
    if (!Number.isInteger(root.initialCandidateIndex) || Number(root.initialCandidateIndex) < 0 || Number(root.initialCandidateIndex) >= executionProfile.models.length) throw new Error("initialCandidateIndex is outside the selected profile models");
    const envelope = { schemaVersion: LAUNCH_ENVELOPE_SCHEMA_VERSION, marker: LAUNCH_ENVELOPE_MARKER, meshId: uuid(root.meshId, "meshId"), agentId: uuid(root.agentId, "agentId"), epochId: uuid(root.epochId, "epochId"), role, selectedProfile, initialCandidateIndex: Number(root.initialCandidateIndex), selfRole, executionProfile, directTargets, roles, profiles, policies, policyDigest: digest, childExtensions } as AgentLaunchEnvelope; Object.defineProperties(envelope, { identity: { enumerable: false, value: `agent:${role}` }, self: { enumerable: false, value: selfRole }, catalog: { enumerable: false, value: roles }, roleSet: { enumerable: false, value: Object.keys(roles) } }); return envelope;
}
type LaunchEnvelopeInput = { meshId: string; agentId: string; epochId: string; role: string; selectedProfile?: string; snapshot: PolicySnapshot; childExtensions: Record<string, string[]>; authorizedProfiles?: readonly string[]; initialCandidateIndex?: number };
export function launchEnvelopeDigest(envelope: AgentLaunchEnvelope): string { return createHash("sha256").update(canonicalJson(validateLaunchEnvelope(envelope))).digest("hex"); }
export function assertLaunchEnvelopeProjection(envelopeValue: unknown, epoch: PolicySnapshot, expectedAuthorizedProfiles: readonly string[]): AgentLaunchEnvelope { const envelope = validateLaunchEnvelope(envelopeValue); validatePolicySnapshotReferences(epoch, "root"); const authorized = envelope.directTargets[envelope.role]!.profiles; const expected = projectPolicyClosure(envelope.role, epoch, expectedAuthorizedProfiles); if (canonicalJson(authorized) !== canonicalJson(expectedAuthorizedProfiles) || envelope.policyDigest !== policyDigest(epoch) || canonicalJson(envelope.roles) !== canonicalJson(expected.roles) || canonicalJson(envelope.profiles) !== canonicalJson(expected.profiles) || canonicalJson(envelope.policies) !== canonicalJson(expected.policies)) throw new Error("launch envelope is not the exact child projection of its actual inbound policy edge"); return envelope; }
function buildLaunchEnvelopeFromSnapshot(input: LaunchEnvelopeInput): AgentLaunchEnvelope { const closure = projectPolicyClosure(input.role, input.snapshot, input.authorizedProfiles); const allowed = closure.directTargets[input.role]!.profiles; const selectedProfile = input.selectedProfile ?? (allowed.length === 1 ? allowed[0] : undefined); if (!selectedProfile || !allowed.includes(selectedProfile) || !closure.profiles[selectedProfile]) throw new Error(`Selected profile ${String(selectedProfile)} is not authorized for role ${input.role}`); const extensions = Object.fromEntries(Object.keys(closure.roles).map(name => { const paths = input.childExtensions[name]; if (!paths) throw new Error(`Missing child extension manifest for ${name}`); return [name, paths]; })); return validateLaunchEnvelope({ schemaVersion: LAUNCH_ENVELOPE_SCHEMA_VERSION, marker: LAUNCH_ENVELOPE_MARKER, meshId: input.meshId, agentId: input.agentId, epochId: input.epochId, role: input.role, selectedProfile, initialCandidateIndex: input.initialCandidateIndex ?? 0, selfRole: closure.roles[input.role], executionProfile: closure.profiles[selectedProfile], directTargets: closure.directTargets, roles: closure.roles, profiles: closure.profiles, policies: closure.policies, policyDigest: policyDigest(input.snapshot), childExtensions: extensions }); }
export function buildLaunchEnvelope(input: LaunchEnvelopeInput): AgentLaunchEnvelope { validatePolicySnapshotReferences(input.snapshot, "root"); return buildLaunchEnvelopeFromSnapshot(input); }
export function projectLaunchEnvelope(role: string, agentId: string, parent: AgentLaunchEnvelope, selectedProfile: string, initialCandidateIndex?: number): AgentLaunchEnvelope { const source = validateLaunchEnvelope(parent); const edge = source.policies[source.role]?.targets[role]; if (!edge || !edge.profiles.includes(selectedProfile)) throw new Error(`Role/profile ${role}/${selectedProfile} is outside caller direct policy`); const snapshot: PolicySnapshot = { mode: "child", directTargets: source.directTargets, roles: source.roles, profiles: source.profiles, policies: source.policies }; const projected = buildLaunchEnvelopeFromSnapshot({ meshId: source.meshId, agentId, epochId: source.epochId, role, selectedProfile, authorizedProfiles: edge.profiles, snapshot, childExtensions: source.childExtensions, initialCandidateIndex }); return validateLaunchEnvelope({ ...projected, policyDigest: source.policyDigest }); }
