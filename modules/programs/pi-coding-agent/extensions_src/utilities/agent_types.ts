import { createHash } from "node:crypto";
import { validateExecutionConfig, type ExecutionConfig } from "./mode_types.ts";

export type AgentHarness = "pi" | "cursor-agent" | "codex";
export type ContextPolicy = "project" | "prompt-only";
export type CapabilityAccess = "read" | "write";
export interface RoleSelector { agent: string; access: CapabilityAccess }
export interface ChildGcPolicy { collectAt: number; retain: number; pressureFloor: number; retireOnContextPressure?: boolean }

/** Omitted retireOnContextPressure permanently means true. Never normalize it into stored digests. */
export function shouldRetireOnContextPressure(policy: ChildGcPolicy | undefined): boolean {
    return policy?.retireOnContextPressure ?? true;
}
export interface ChildDefinition {
    selector: RoleSelector;
    description: string;
    tools: string[];
    instructions: string;
    contextPolicy: ContextPolicy;
    childExtensionContributions: string[];
    execution: ExecutionConfig;
    targets: string[];
    gc: ChildGcPolicy;
}
export interface ChildCatalog { schemaVersion: 1; children: Record<string, ChildDefinition> }
export interface CallerPolicy { targets: string[] }
export interface CallPolicy { modes: Record<string, CallerPolicy> }
export interface MeshBudgets { maxLiveAgents: number; maxConcurrentTasks: number; maxTasksPerMesh: number }
export interface MeshGcTiming { contextHeadroomTokens: number; periodicIntervalMs: number; activityHeartbeatMs: number; activityStaleMs: number }
export interface MeshGcConfig extends MeshGcTiming { children: Record<string, ChildGcPolicy> }
export interface HarnessRuntimeConfig { adapter: "pi-native" | "cursor-acp" | "codex-acp"; command: string; workerCommand?: string; workerEntrypoint?: string; bridgeReadyTimeoutMs?: number; modelIds?: Record<string, string> }
export interface OrchestrationConfig { schemaVersion: 6; stateRoot: string; tmux: string; returnParentCommand: string; parentNavigationHint: string; historyViewerExtension: string; popupExtension: string; orchestrationExtension: string; childBridgeExtension: string; harnesses: Record<string, HarnessRuntimeConfig>; natureHandleWords: string[]; callPolicy: CallPolicy; budgets: MeshBudgets; gc: MeshGcTiming }
export interface PolicySnapshot {
    mode: string;
    directTargets: string[];
    children: Record<string, ChildDefinition>;
}
export const LAUNCH_ENVELOPE_SCHEMA_VERSION = 8 as const;
export const LAUNCH_ENVELOPE_MARKER = "pi-mesh-child-launch-v8";
export interface AgentLaunchEnvelope {
    schemaVersion: 8;
    marker: "pi-mesh-child-launch-v8";
    meshId: string;
    agentId: string;
    epochId: string;
    childId: string;
    initialCandidateIndex: number;
    children: Record<string, ChildDefinition>;
    policyDigest: string;
    childExtensions: Record<string, string[]>;
    readonly identity: string;
    readonly self: ChildDefinition;
    readonly catalog: Record<string, ChildDefinition>;
    readonly childSet: string[];
}

export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value !== "object") return JSON.stringify(value);
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

export function validateChildGcPolicy(value: unknown, label: string): ChildGcPolicy {
    const item = object(value, label); exact(item, ["collectAt", "retain", "pressureFloor"], ["retireOnContextPressure"], label);
    const policy = { collectAt: positive(item.collectAt, `${label}.collectAt`), retain: nonnegative(item.retain, `${label}.retain`), pressureFloor: nonnegative(item.pressureFloor, `${label}.pressureFloor`) };
    if (policy.collectAt < policy.retain || policy.retain < policy.pressureFloor) throw new Error(`${label} hysteresis is invalid`);
    if (item.retireOnContextPressure !== undefined && typeof item.retireOnContextPressure !== "boolean") throw new Error(`${label}.retireOnContextPressure must be a boolean`);
    return item.retireOnContextPressure === undefined ? policy : { ...policy, retireOnContextPressure: item.retireOnContextPressure };
}

export function validateChildDefinition(name: string, value: unknown, label = `children.${name}`): ChildDefinition {
    const raw = object(value, label); exact(raw, ["selector", "description", "tools", "instructions", "contextPolicy", "childExtensionContributions", "execution", "targets", "gc"], [], label);
    const selectorRaw = object(raw.selector, `${label}.selector`); exact(selectorRaw, ["agent", "access"], [], `${label}.selector`);
    if (selectorRaw.access !== "read" && selectorRaw.access !== "write") throw new Error(`${label}.selector.access is invalid`);
    const selector: RoleSelector = { agent: text(selectorRaw.agent, `${label}.selector.agent`), access: selectorRaw.access };
    if (raw.contextPolicy !== "project" && raw.contextPolicy !== "prompt-only") throw new Error(`${label}.contextPolicy is invalid`);
    return { selector, description: text(raw.description, `${label}.description`), tools: strings(raw.tools, `${label}.tools`), instructions: text(raw.instructions, `${label}.instructions`), contextPolicy: raw.contextPolicy, childExtensionContributions: strings(raw.childExtensionContributions, `${label}.childExtensionContributions`), execution: validateExecutionConfig(raw.execution, `${label}.execution`), targets: strings(raw.targets, `${label}.targets`), gc: validateChildGcPolicy(raw.gc, `${label}.gc`) };
}
export function validateChildCatalog(value: unknown): ChildCatalog {
    const root = object(value, "child catalog"); exact(root, ["schemaVersion", "children"], [], "child catalog"); if (root.schemaVersion !== 1) throw new Error("Unsupported child catalog schemaVersion");
    return { schemaVersion: 1, children: Object.fromEntries(Object.entries(object(root.children, "children")).map(([name, child]) => [text(name, "child name"), validateChildDefinition(name, child)])) };
}

export function validateCallerPolicy(value: unknown, label: string): CallerPolicy { const raw = object(value, label); exact(raw, ["targets"], [], label); return { targets: strings(raw.targets, `${label}.targets`) }; }
function validateCallPolicy(value: unknown): CallPolicy { const raw = object(value, "callPolicy"); exact(raw, ["modes"], [], "callPolicy"); return { modes: Object.fromEntries(Object.entries(object(raw.modes, "callPolicy.modes")).map(([name, policy]) => [name, validateCallerPolicy(policy, `callPolicy.modes.${name}`)])) }; }
function validateGcTiming(value: unknown): MeshGcTiming {
    const gcRaw = object(value, "gc"); exact(gcRaw, ["contextHeadroomTokens", "periodicIntervalMs", "activityHeartbeatMs", "activityStaleMs"], [], "gc");
    const gc = { contextHeadroomTokens: positive(gcRaw.contextHeadroomTokens, "gc.contextHeadroomTokens"), periodicIntervalMs: positive(gcRaw.periodicIntervalMs, "gc.periodicIntervalMs"), activityHeartbeatMs: positive(gcRaw.activityHeartbeatMs, "gc.activityHeartbeatMs"), activityStaleMs: positive(gcRaw.activityStaleMs, "gc.activityStaleMs") };
    if (gc.activityStaleMs <= gc.activityHeartbeatMs) throw new Error("activityStaleMs must exceed activityHeartbeatMs");
    return gc;
}
export function validateOrchestrationConfig(value: unknown): OrchestrationConfig {
    const root = object(value, "orchestration config"); exact(root, ["schemaVersion", "stateRoot", "tmux", "returnParentCommand", "parentNavigationHint", "historyViewerExtension", "popupExtension", "orchestrationExtension", "childBridgeExtension", "harnesses", "natureHandleWords", "callPolicy", "budgets", "gc"], [], "orchestration config"); if (root.schemaVersion !== 6) throw new Error("Unsupported orchestration config schemaVersion");
    const harnesses: Record<string, HarnessRuntimeConfig> = {};
    for (const [name, itemValue] of Object.entries(object(root.harnesses, "harnesses"))) { const item = object(itemValue, `harnesses.${name}`); const cursor = item.adapter === "cursor-acp"; exact(item, ["adapter", "command", ...(cursor ? ["modelIds"] : [])], ["workerCommand", "workerEntrypoint", "bridgeReadyTimeoutMs"], `harnesses.${name}`); if (item.adapter !== "pi-native" && item.adapter !== "cursor-acp" && item.adapter !== "codex-acp") throw new Error(`harnesses.${name}.adapter is invalid`); const modelIds = cursor ? Object.fromEntries(Object.entries(object(item.modelIds, `harnesses.${name}.modelIds`)).map(([alias, modelId]) => [text(alias, `harnesses.${name}.modelIds alias`), text(modelId, `harnesses.${name}.modelIds.${alias}`)])) : undefined; harnesses[name] = { adapter: item.adapter, command: text(item.command, `harnesses.${name}.command`), ...(item.workerCommand === undefined ? {} : { workerCommand: text(item.workerCommand, `harnesses.${name}.workerCommand`) }), ...(item.workerEntrypoint === undefined ? {} : { workerEntrypoint: text(item.workerEntrypoint, `harnesses.${name}.workerEntrypoint`) }), ...(item.bridgeReadyTimeoutMs === undefined ? {} : { bridgeReadyTimeoutMs: positive(item.bridgeReadyTimeoutMs, `harnesses.${name}.bridgeReadyTimeoutMs`) }), ...(modelIds ? { modelIds } : {}) }; }
    const budgetRaw = object(root.budgets, "budgets"); exact(budgetRaw, ["maxLiveAgents", "maxConcurrentTasks", "maxTasksPerMesh"], [], "budgets"); const budgets = { maxLiveAgents: positive(budgetRaw.maxLiveAgents, "budgets.maxLiveAgents"), maxConcurrentTasks: positive(budgetRaw.maxConcurrentTasks, "budgets.maxConcurrentTasks"), maxTasksPerMesh: positive(budgetRaw.maxTasksPerMesh, "budgets.maxTasksPerMesh") }; if (budgets.maxConcurrentTasks > budgets.maxTasksPerMesh) throw new Error("maxConcurrentTasks must not exceed maxTasksPerMesh");
    return { schemaVersion: 6, stateRoot: text(root.stateRoot, "stateRoot"), tmux: text(root.tmux, "tmux"), returnParentCommand: text(root.returnParentCommand, "returnParentCommand"), parentNavigationHint: text(root.parentNavigationHint, "parentNavigationHint"), historyViewerExtension: text(root.historyViewerExtension, "historyViewerExtension"), popupExtension: text(root.popupExtension, "popupExtension"), orchestrationExtension: text(root.orchestrationExtension, "orchestrationExtension"), childBridgeExtension: text(root.childBridgeExtension, "childBridgeExtension"), harnesses, natureHandleWords: strings(root.natureHandleWords, "natureHandleWords"), callPolicy: validateCallPolicy(root.callPolicy), budgets, gc: validateGcTiming(root.gc) };
}

export type AuthorizedSelector = { childId: string; selector: RoleSelector; definition: ChildDefinition };
function selectorKey(selector: RoleSelector): string { return `${selector.agent}\u0000${selector.access}`; }
export function resolveAuthorizedSelectors(policy: CallerPolicy, children: Readonly<Record<string, ChildDefinition>>): AuthorizedSelector[] {
    const seen = new Map<string, string>();
    return policy.targets.map(childId => {
        const definition = children[childId];
        if (!definition) throw new Error(`Authorized edge references unknown child ${childId}`);
        const key = selectorKey(definition.selector); const prior = seen.get(key);
        if (prior) throw new Error(`Authorized selectors ${prior} and ${childId} are ambiguous`);
        seen.set(key, childId);
        return { childId, selector: structuredClone(definition.selector), definition };
    });
}

export function publicCapability(selector: RoleSelector): string {
    return `${selector.agent}/${selector.access}`;
}

function policyEdges(catalog: ChildCatalog, callPolicy: CallPolicy): Array<{ caller?: string; target: string }> {
    return [
        ...Object.values(callPolicy.modes).flatMap(policy => policy.targets.map(target => ({ target }))),
        ...Object.entries(catalog.children).flatMap(([caller, child]) => child.targets.map(target => ({ caller, target }))),
    ];
}
export function validateOrchestrationReferences(config: OrchestrationConfig, catalog: ChildCatalog, modeNames?: readonly string[]): void {
    const knownChildren = new Set(Object.keys(catalog.children)); const knownModes = modeNames === undefined ? undefined : new Set(modeNames);
    for (const mode of Object.keys(config.callPolicy.modes)) if (knownModes && !knownModes.has(mode)) throw new Error(`callPolicy references unknown mode caller: ${mode}`);
    for (const policy of Object.values(config.callPolicy.modes)) resolveAuthorizedSelectors(policy, catalog.children);
    for (const [_caller, child] of Object.entries(catalog.children)) resolveAuthorizedSelectors({ targets: child.targets }, catalog.children);
    for (const edge of policyEdges(catalog, config.callPolicy)) if (!knownChildren.has(edge.target)) throw new Error(`callPolicy references unknown child target: ${edge.target}`);
    for (const [name, child] of Object.entries(catalog.children)) if (child.execution.harness === "cursor-agent") { const alias = child.execution.models[0]!.slice("cursor/".length); if (!config.harnesses[child.execution.harness]?.modelIds?.[alias]) throw new Error(`Cursor child ${name} has no configured ACP model ID for ${alias}`); }
    for (const [mode, policy] of Object.entries(config.callPolicy.modes)) if (policy.targets.some(target => catalog.children[target]?.selector.agent === "search")) throw new Error(`search capability cannot be a root target in mode ${mode}`);
    for (const [caller, child] of Object.entries(catalog.children)) if (caller !== "research" && child.targets.some(target => catalog.children[target]?.selector.agent === "search")) throw new Error(`search capability may only be targeted by research, not ${caller}`);
    for (const [name, child] of Object.entries(catalog.children)) {
        if (child.targets.length && child.execution.harness !== "pi") throw new Error(`external-harness caller ${name} cannot have outbound edges`);
        if (child.targets.length && child.contextPolicy === "prompt-only") throw new Error(`prompt-only caller ${name} cannot have outbound edges`);
        if (child.contextPolicy === "prompt-only" && child.execution.harness !== "pi") throw new Error(`prompt-only child ${name} may use only Pi execution`);
    }
}

function closureFrom(seeds: readonly string[], children: Readonly<Record<string, ChildDefinition>>): string[] { const seen = new Set<string>(); const pending = [...seeds]; while (pending.length) { const childId = pending.shift()!; if (seen.has(childId)) continue; if (!children[childId]) throw new Error(`call policy references unknown child: ${childId}`); seen.add(childId); pending.push(...children[childId]!.targets); } return [...seen]; }
export function buildPolicySnapshot(input: { mode: string; catalog: ChildCatalog; callPolicy: CallPolicy }): PolicySnapshot {
    const directTargets = [...(input.callPolicy.modes[input.mode]?.targets ?? [])]; const names = closureFrom(directTargets, input.catalog.children); const children = Object.fromEntries(names.map(name => [name, structuredClone(input.catalog.children[name]!)])); const snapshot = { mode: input.mode, directTargets, children }; validatePolicySnapshotReferences(snapshot, "root"); return snapshot;
}
export function policyDigest(input: PolicySnapshot): string { return createHash("sha256").update(canonicalJson({ mode: input.mode, directTargets: input.directTargets, children: input.children })).digest("hex"); }
export type PolicySnapshotScope = "root" | "child";
export function validatePolicySnapshotReferences(snapshot: PolicySnapshot, scope: PolicySnapshotScope): void {
    for (const name of snapshot.directTargets) if (!snapshot.children[name]) throw new Error(`Policy snapshot direct target ${name} is outside children`);
    resolveAuthorizedSelectors({ targets: snapshot.directTargets }, snapshot.children);
    for (const [name, child] of Object.entries(snapshot.children)) {
        resolveAuthorizedSelectors({ targets: child.targets }, snapshot.children);
        if (name !== "research" && child.targets.some(target => snapshot.children[target]?.selector.agent === "search")) throw new Error(`search capability may only be targeted by research, not ${name}`);
        for (const target of child.targets) if (!snapshot.children[target]) throw new Error(`Policy snapshot ${name} target ${target} is outside children`);
    }
    if (scope === "root" && snapshot.directTargets.some(name => snapshot.children[name]?.selector.agent === "search")) throw new Error("search capability cannot be a root target");
    for (const [name, definition] of Object.entries(snapshot.children)) {
        if (definition.targets.length && definition.execution.harness !== "pi") throw new Error(`external harness caller ${name} cannot have outbound policy`);
        if (definition.targets.length && definition.contextPolicy === "prompt-only") throw new Error(`Prompt-only caller ${name} cannot have outbound policy`);
        if (definition.contextPolicy === "prompt-only" && definition.execution.harness !== "pi") throw new Error(`Prompt-only child ${name} may use only Pi execution`);
    }
}
export function projectPolicyClosure(childId: string, snapshot: PolicySnapshot): PolicySnapshot {
    validatePolicySnapshotReferences(snapshot, "child");
    const names = closureFrom([childId], snapshot.children); const children = Object.fromEntries(names.map(name => [name, structuredClone(snapshot.children[name]!)])); const projected = { mode: snapshot.mode, directTargets: [childId], children }; validatePolicySnapshotReferences(projected, "child"); return projected;
}
function envelopeSelf(envelope: Pick<AgentLaunchEnvelope, "childId" | "children">): ChildDefinition {
    const self = envelope.children[envelope.childId];
    if (!self) throw new Error("launch closure must contain child");
    return self;
}
export function validateLaunchEnvelope(value: unknown): AgentLaunchEnvelope {
    const root = object(value, "agent launch envelope"); exact(root, ["schemaVersion", "marker", "meshId", "agentId", "epochId", "childId", "initialCandidateIndex", "children", "policyDigest", "childExtensions"], [], "agent launch envelope"); if (root.schemaVersion !== LAUNCH_ENVELOPE_SCHEMA_VERSION || root.marker !== LAUNCH_ENVELOPE_MARKER) throw new Error("Unsupported agent launch envelope schema or marker");
    const childId = text(root.childId, "childId"); const children = Object.fromEntries(Object.entries(object(root.children, "children")).map(([name, definition]) => [name, validateChildDefinition(name, definition)])); if (!children[childId]) throw new Error("launch closure must contain child");
    const childExtensions = Object.fromEntries(Object.entries(object(root.childExtensions, "childExtensions")).map(([name, paths]) => [name, strings(paths, `childExtensions.${name}`)])); if (canonicalJson(Object.keys(childExtensions).sort()) !== canonicalJson(Object.keys(children).sort())) throw new Error("childExtensions must exactly cover closure children"); const digest = text(root.policyDigest, "policyDigest"); if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error("policyDigest must be SHA-256");
    const execution = children[childId]!.execution;
    if (!Number.isInteger(root.initialCandidateIndex) || Number(root.initialCandidateIndex) < 0 || Number(root.initialCandidateIndex) >= execution.models.length) throw new Error("initialCandidateIndex is outside the selected execution models");
    validatePolicySnapshotReferences({ mode: "child", directTargets: [childId], children }, "child");
    const envelope = { schemaVersion: LAUNCH_ENVELOPE_SCHEMA_VERSION, marker: LAUNCH_ENVELOPE_MARKER, meshId: uuid(root.meshId, "meshId"), agentId: uuid(root.agentId, "agentId"), epochId: uuid(root.epochId, "epochId"), childId, initialCandidateIndex: Number(root.initialCandidateIndex), children, policyDigest: digest, childExtensions } as AgentLaunchEnvelope;
    const self = envelopeSelf(envelope);
    Object.defineProperties(envelope, { identity: { enumerable: false, value: `agent:${childId}` }, self: { enumerable: false, value: self }, catalog: { enumerable: false, value: children }, childSet: { enumerable: false, value: Object.keys(children) } });
    return envelope;
}
type LaunchEnvelopeInput = { meshId: string; agentId: string; epochId: string; childId: string; snapshot: PolicySnapshot; childExtensions: Record<string, string[]>; initialCandidateIndex?: number };
export function launchEnvelopeDigest(envelope: AgentLaunchEnvelope): string { return createHash("sha256").update(canonicalJson(validateLaunchEnvelope(envelope))).digest("hex"); }
export function assertLaunchEnvelopeProjection(envelopeValue: unknown, epoch: PolicySnapshot, expectedChildId: string): AgentLaunchEnvelope {
    const envelope = validateLaunchEnvelope(envelopeValue); validatePolicySnapshotReferences(epoch, "root");
    if (envelope.childId !== expectedChildId) throw new Error("launch envelope child does not match inbound policy edge");
    const expected = projectPolicyClosure(expectedChildId, epoch);
    if (envelope.policyDigest !== policyDigest(epoch) || canonicalJson(envelope.children) !== canonicalJson(expected.children)) throw new Error("launch envelope is not the exact child projection of its actual inbound policy edge");
    return envelope;
}
function buildLaunchEnvelopeFromSnapshot(input: LaunchEnvelopeInput): AgentLaunchEnvelope {
    const closure = projectPolicyClosure(input.childId, input.snapshot);
    const extensions = Object.fromEntries(Object.keys(closure.children).map(name => { const paths = input.childExtensions[name]; if (!paths) throw new Error(`Missing child extension manifest for ${name}`); return [name, paths]; }));
    return validateLaunchEnvelope({ schemaVersion: LAUNCH_ENVELOPE_SCHEMA_VERSION, marker: LAUNCH_ENVELOPE_MARKER, meshId: input.meshId, agentId: input.agentId, epochId: input.epochId, childId: input.childId, initialCandidateIndex: input.initialCandidateIndex ?? 0, children: closure.children, policyDigest: policyDigest(input.snapshot), childExtensions: extensions });
}
export function buildLaunchEnvelope(input: LaunchEnvelopeInput): AgentLaunchEnvelope { validatePolicySnapshotReferences(input.snapshot, "root"); if (!input.snapshot.directTargets.includes(input.childId) && !Object.values(input.snapshot.children).some(child => child.targets.includes(input.childId))) throw new Error(`Child ${input.childId} is outside policy snapshot`); return buildLaunchEnvelopeFromSnapshot(input); }
export function projectLaunchEnvelope(childId: string, agentId: string, parent: AgentLaunchEnvelope, initialCandidateIndex?: number): AgentLaunchEnvelope {
    const source = validateLaunchEnvelope(parent);
    if (!source.self.targets.includes(childId)) throw new Error(`Child ${childId} is outside caller direct policy`);
    const snapshot: PolicySnapshot = { mode: "child", directTargets: [source.childId], children: source.children };
    const projected = buildLaunchEnvelopeFromSnapshot({ meshId: source.meshId, agentId, epochId: source.epochId, childId, snapshot, childExtensions: source.childExtensions, initialCandidateIndex });
    return validateLaunchEnvelope({ ...projected, policyDigest: source.policyDigest });
}

export function meshGcConfig(timing: MeshGcTiming, catalog: ChildCatalog): MeshGcConfig {
    return { ...timing, children: Object.fromEntries(Object.entries(catalog.children).map(([name, child]) => [name, child.gc])) };
}
export function envelopeExecution(envelope: AgentLaunchEnvelope): ExecutionConfig { return envelope.self.execution; }
export function callerPolicyFrom(children: Readonly<Record<string, ChildDefinition>>, childId: string): CallerPolicy { return { targets: [...(children[childId]?.targets ?? [])] }; }
