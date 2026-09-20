import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { StringEnum, type Usage } from "@earendil-works/pi-ai";
import { defineTool, getAgentDir, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { emitResolvedAgent } from "./utilities/agent_events.ts";
import { buildLaunchEnvelope, canonicalJson, meshGcConfig, projectLaunchEnvelope, publicCapability, resolveAuthorizedSelectors, validateChildCatalog, validateLaunchEnvelope, validateOrchestrationConfig, validateOrchestrationReferences, type ChildCatalog, type ChildDefinition, type AgentLaunchEnvelope, type RoleSelector } from "./utilities/agent_types.ts";
import { validateModeConfig, type AgentModeConfig } from "./utilities/mode_types.ts";
import { initialModelRoute, preflightProfileCandidates } from "./utilities/orchestration_profile_fallback.ts";
import { createActiveModeBarrier, onActiveMode, type ActiveModeBarrier, type ActiveModeEvent } from "./utilities/mode_events.ts";
import { PARENT_TRANSITION_REQUEST_EVENT, PARENT_TRANSITION_RESULT_EVENT, hasParentTransitionUnlocked, prepareParentTransition, readParentTransition, releaseParentTransition, validateParentTransitionRequest, type ParentTransitionRequest, type ParentTransitionResult } from "./utilities/orchestration_transition.ts";
import { resolveCursorAcpModelId, resolveHarnessAdapter } from "./utilities/orchestration_harness.ts";
import { cleanupMeshAgents, failStartedMeshAgent, readReconciledAgentSnapshot, recoverPendingAgentStops, stopMeshAgentWithDisposition, stopMeshTaskWithDisposition } from "./utilities/orchestration_management.ts";
import { reserveNewAgentCapacityWithPressure, runPeriodicAgentGc } from "./utilities/orchestration_gc.ts";
import { awaitPressureAdmission, failOpenPressureAdmissions, processPressureAdmissions, reconcilePressureAdmissions } from "./utilities/orchestration_admission.ts";
import { configuredModelDiagnosticNames, exceedsModelVisibleLimit, packCompactCompletionDelivery, projectDebugSnapshot, projectMeshCompletionContext, projectMeshRetrievalTask, projectMinimalAgentTask, projectMinimalSubmitResult, publicCapabilityFields, receiptIdsFromToolResults, sanitizeModelVisibleError, sanitizeSnapshot, serializeModelVisibleJson, type AgentToolDetails, type MeshOutputMode, type SubmitDetails } from "./utilities/orchestration_projection.ts";
import { acknowledgeMeshContextInterventions, acknowledgeMeshEvents, bindMeshEndpoint, isLiveMeshEndpointBinding, markMeshEventsInjected, materializeMeshCompletionEvents, readEndpointDeliverySnapshot, registerMeshReport, registerStateAwareMeshSend, reserveNewAgentMeshSendSubmission, resolveRouteEndpoint, setMeshEndpointOffline, validateMeshEvent, type FrozenTask, type MeshDelivery, type MeshEndpoint, type MeshEvent, type MeshSendResult } from "./utilities/orchestration_events.ts";
import { OrchestrationDeadlineScheduler } from "./utilities/orchestration_cadence.ts";
import { createCompletionReceipt, createNotificationCompletionReceipt, readCompletionLedger, reconcileCompletionReceipts, rollbackCompletionReceipt, type CompletionReceiptCreationResult } from "./utilities/orchestration_completion.ts";
import { attachRootMesh, applyAgentControl, beginMeshClose, claimTaskUsage, completeMeshClose, createTask, descendantAgentIds, ensurePolicyEpoch, heartbeatRootLease, initializeMesh, listMeshAgents, meshPaths, prepareAgent, publishAgent, readAgentExecution, readAgentSnapshot, readMesh, readPersistedCompletionReceiptEvidence, readPolicyEpoch, readTask, reconcileMeshReservations, reconcileMeshState, reconcileMeshUsageClaims, releaseMeshReservation, removePreparedAgent, rollbackTaskUsageClaim, taskPaths, validateStopReason } from "./utilities/orchestration_store.ts";
import { AgentLaunchCleanupError, inspectAgentTmux, inspectMeshAgentWindow, launchAgentSession, probeTmux, stopAgentSession, type CommandExecutor } from "./utilities/orchestration_tmux.ts";
import { isTerminalAgent, isTerminalTask, optionalTaskPurpose, POLICY_EPOCH_SCHEMA_VERSION, type AgentSnapshot, type CompletionTarget, type PolicyEpoch, type SubagentRuntimeConfig } from "./utilities/orchestration_types.ts";
import { MeshAgentsPaletteComponent, type MeshPaletteDependencies } from "./utilities/orchestration_palette.ts";

import { buildChildExtensionManifest, MESH_PEER_TOOL_NAMES, MESH_REPORT_TOOL_NAME } from "./utilities/orchestration_pi.ts";
import { renderAgentToolResult, renderControlCall, renderControlResult, renderEndResponseCall, renderEndResponseResult, renderGetCall, renderMeshEventMessage, renderReportCall, renderReportResult, renderSendCall, renderSendResult, renderStopCall, renderStopResult } from "./utilities/orchestration_cards.ts";
import { openPopupView, providePopupView } from "./popup.ts";
import { loadPaletteKeymap } from "./utilities/command_palette_keymap.ts";
import { loadFeatureKeybindings } from "./utilities/extension_keybindings.ts";
import { provideCommandPaletteContribution } from "./utilities/command_palette_contributions.ts";
import { acknowledgeDisplayedTuiNotice, listPendingTuiNotices, type TuiNotice } from "./utilities/orchestration_notices.ts";
import { bindAgentRuntime, readAgentRuntimeBinding } from "./utilities/orchestration_runtime.ts";
import { assertExpectedEndpointBinding } from "./utilities/orchestration_binding.ts";
import { collectEndpointAgentIds, displayIdentityForAgentId, displayIdentityForSnapshot, formatUsualIdentityLine, handleForAgentId, MESH_CHILD_IDENTITY_STATUS, publicCapabilityLabel, type AgentDisplayIdentity } from "./utilities/orchestration_identity.ts";
import { createDirectoryWake, endpointBindingInboxDirectory, rootCompletionQueueDirectory, type DirectoryWake, type DirectoryWakeDependencies } from "./utilities/orchestration_wake.ts";
import { END_RESPONSE_ERROR_STANDALONE, END_RESPONSE_TOOL_NAME, MESH_CONTROL_TOOL_NAME, ProcessExecutionGate, isJoinableAgentEnd, meshYieldNextAction, projectExecutionPhase, shouldOpenExecutionGate, type ControlAction, type ControlSource, type ControlTargetStatus } from "./utilities/orchestration_execution.ts";
import { MeshArmedWait, type MeshWaitInspection } from "./utilities/orchestration_wait.ts";


const CONFIG = join(getAgentDir(), "orchestration.json"); const CATALOG = join(getAgentDir(), "child-catalog.json"); const MODES = join(getAgentDir(), "agent-modes.json");
const ROOT_BINDING = "mesh-root-binding-v11"; const POLICY_BINDING = "mesh-policy-epoch-v11"; const PARENT_STATUS = "mesh-parent-navigation"; const PUMP_STATUS = "mesh-event-pump"; const WAIT_STATUS = "mesh-auto-join"; const NOTICE_PUMP_STATUS = "mesh-notice-pump"; const NOTICE_ENTRY = "mesh-tui-notice"; const COMPLETION_DELIVERY_WINDOW_MS = 5_000;
interface RootBinding { schemaVersion: 1; meshId: string }
interface EpochBinding { schemaVersion: 1; meshId: string; mode: string; epochId: string; policyDigest: string }
export interface ActiveCaller { identity: string; meshId: string; epoch: PolicyEpoch; catalog: ChildCatalog; envelope?: AgentLaunchEnvelope; agentId?: string; runtimeId?: string; endpointId: string; sessionFile?: string; error?: string }
export interface OrchestrationDependencies { configPath: string; catalogPath?: string; modePath?: string; env: NodeJS.ProcessEnv; exec: CommandExecutor; activeCaller?: () => ActiveCaller | undefined; authorityBarrier?: () => Promise<void>; rootLeaseId?: () => string | undefined; natureHandleWords?: () => readonly string[]; currentBatchTools?: () => ReadonlyMap<string, string>; trackWaitTask?: (caller: ActiveCaller, taskId: string) => void; untrackWaitTask?: (caller: ActiveCaller, taskId: string) => void; applyControl?: (caller: ActiveCaller, agentId: string, action: ControlAction, source: ControlSource) => Promise<{ requestId: string; action: ControlAction; targets: Array<{ agentId: string; status: ControlTargetStatus; phase: string }> }>; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number }
export interface OrchestrationRegistrationOptions extends Partial<Pick<OrchestrationDependencies, "configPath" | "catalogPath" | "modePath" | "env">> { setInterval?: (callback: () => void | Promise<void>, delay: number) => unknown; clearInterval?: (timer: unknown) => void; now?: () => number; onAuthorityWait?: () => void; wake?: DirectoryWakeDependencies }
export async function loadOrchestrationConfig(path: string): Promise<SubagentRuntimeConfig> { try { return validateOrchestrationConfig(JSON.parse(await readFile(path, "utf8"))); } catch (error) { throw new Error(`Cannot read orchestration config ${path}: ${error instanceof Error ? error.message : String(error)}`); } }
export async function loadChildCatalog(path: string): Promise<ChildCatalog> { try { return validateChildCatalog(JSON.parse(await readFile(path, "utf8"))); } catch (error) { throw new Error(`Cannot read child catalog ${path}: ${error instanceof Error ? error.message : String(error)}`); } }
export async function loadAgentModes(path: string): Promise<AgentModeConfig> { try { return validateModeConfig(JSON.parse(await readFile(path, "utf8"))); } catch (error) { throw new Error(`Cannot read agent modes ${path}: ${error instanceof Error ? error.message : String(error)}`); } }
function sleep(ms: number, signal?: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { if (signal?.aborted) return reject(signal.reason); const timer = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); }); }
function active(deps: OrchestrationDependencies): ActiveCaller { const value = deps.activeCaller?.(); if (!value) throw new Error("Mesh unavailable: runtime identity is not attached"); if (value.error) throw new Error("Mesh unavailable: immutable orchestration authority is unavailable"); return value; }
async function authorized(deps: OrchestrationDependencies): Promise<ActiveCaller> { await deps.authorityBarrier?.(); return active(deps); }
async function reauthorizeCaller(deps: OrchestrationDependencies, captured: ActiveCaller): Promise<ActiveCaller> { const current = await authorized(deps); if (current.meshId !== captured.meshId || current.agentId !== captured.agentId || current.endpointId !== captured.endpointId || current.sessionFile !== captured.sessionFile) throw new Error("Mesh caller principal changed before mutation"); return current; }
async function reauthorizeReservedCaller(deps: OrchestrationDependencies, captured: ActiveCaller): Promise<ActiveCaller> { const current = await reauthorizeCaller(deps, captured); if (current.epoch.epochId !== captured.epoch.epochId || current.epoch.policyDigest !== captured.epoch.policyDigest) throw new Error("Mesh caller authority changed after capacity reservation"); return current; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}; }
function prepareRetrievalArguments<T>(value: unknown): T { const args = asRecord(value); return { ...args, outputMode: args.outputMode ?? "compact" } as T; }
function canonicalRetrievalArguments<T extends { outputMode?: MeshOutputMode }>(value: T): Omit<T, "outputMode"> | T { if (value.outputMode !== "compact") return value; const { outputMode: _default, ...legacyCompatible } = value; return legacyCompatible; }
function branchData<T>(ctx: ExtensionContext, customType: string): T | undefined { const entry = [...ctx.sessionManager.getBranch()].reverse().find(item => item.type === "custom" && item.customType === customType) as { data?: unknown } | undefined; return entry?.data as T | undefined; }
function errorText(value: unknown): string { return value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value) ?? "Unknown error"; }
function callerPolicy(caller: ActiveCaller) { return caller.agentId ? { targets: caller.envelope?.self.targets ?? [] } : { targets: caller.epoch.directTargets }; }
function callerChildren(caller: ActiveCaller): Record<string, ChildDefinition> { return caller.agentId ? caller.envelope?.children ?? {} : caller.epoch.children; }
function childTargets(caller: ActiveCaller): Record<string, ChildDefinition> { const children = callerChildren(caller); return Object.fromEntries(callerPolicy(caller).targets.map(name => [name, children[name]!]).filter(([, definition]) => definition)); }
function authorizedSelectorRoutes(caller: ActiveCaller) { return resolveAuthorizedSelectors(callerPolicy(caller), callerChildren(caller)); }
function requester(caller: ActiveCaller): { requesterEndpointId: string; requesterAgentId?: string } { return { requesterEndpointId: caller.endpointId, ...(caller.agentId ? { requesterAgentId: caller.agentId } : {}) }; }
function dispatchAuthority(caller: ActiveCaller, targetChildId: string) { return { ...requester(caller), ...(caller.sessionFile ? { requesterEndpointSessionFile: caller.sessionFile } : {}), ...(caller.agentId && caller.runtimeId ? { requesterRuntimeId: caller.runtimeId } : {}), epochId: caller.epoch.epochId, policyDigest: caller.epoch.policyDigest, targetChildId }; }
function publicCallerLabel(caller: ActiveCaller): string {
    if (!caller.agentId) return caller.identity;
    const selector = caller.envelope?.self.selector;
    return selector ? publicCapability(selector) : "nested caller";
}
function resolveSelectedCapability(caller: ActiveCaller, selector: RoleSelector, action: string) { const route = authorizedSelectorRoutes(caller).find(candidate => candidate.selector.agent === selector.agent && candidate.selector.access === selector.access); if (!route) throw new Error(`${publicCallerLabel(caller)} is not allowed to ${action} capability ${publicCapability(selector)}`); return route; }
function authorizeDirectChild(caller: ActiveCaller, childId: string, action: string) { const route = authorizedSelectorRoutes(caller).find(candidate => candidate.childId === childId); if (!route) throw new Error(`${publicCallerLabel(caller)} is not allowed to ${action} this agent capability`); return route; }
function authorizeTask(caller: ActiveCaller, task: Awaited<ReturnType<typeof readTask>>, action: string): void { if (!caller.agentId) return; if (task.request.requesterAgentId !== caller.agentId || task.request.requesterEndpointId !== caller.endpointId) throw new Error(`${publicCallerLabel(caller)} is not allowed to ${action} task ${task.request.taskId}`); }
function authorizeAgent(caller: ActiveCaller, snapshot: AgentSnapshot, action: string): void { if (!caller.agentId) return; if (snapshot.agent.parentAgentId !== caller.agentId) throw new Error(`${publicCallerLabel(caller)} is not allowed to ${action} agent ${snapshot.agent.agentId}; caller is not its direct parent`); }
function authorizeReuse(caller: ActiveCaller, snapshot: AgentSnapshot): void { const edge = authorizeDirectChild(caller, snapshot.agent.childId, "reuse"); if (canonicalJson(snapshot.agent.definitionSnapshot) !== canonicalJson(edge.definition)) throw new Error(`Agent ${snapshot.agent.agentId} does not match the current immutable capability route`); }
function rejectSelfAgent(caller: ActiveCaller, agentId: string, operation: string): void { if (caller.agentId === agentId) throw new Error(`mesh_${operation} cannot target the calling agent itself (${agentId})`); }
function joinDisplay(parts: Array<string | undefined>): string {
    return parts.filter((part): part is string => Boolean(part)).join(" · ");
}
export function tuiNoticeText(notice: TuiNotice, expanded = false, words?: readonly string[]): string {
    if (notice.kind === "explicit-stop") {
        const handle = handleForAgentId(notice.payload.agentId, words);
        const capability = publicCapabilityLabel({ publicAgent: notice.payload.agent, access: notice.payload.access });
        const identity = joinDisplay([handle, capability, notice.payload.purpose]);
        const summary = joinDisplay(["Agent stopped", identity, notice.payload.reason]);
        return expanded ? `${summary}\nagentId: ${notice.payload.agentId}\nsource: ${notice.payload.source}\nnoticeId: ${notice.noticeId}` : summary;
    }
    const summary = `Mesh GC · ${notice.payload.confirmed.length} stopped · ${notice.payload.failedCount} failed · ${notice.payload.pendingCount} pending`;
    const agents = notice.payload.confirmed.map(item => {
        const handle = handleForAgentId(item.agentId, words);
        const capability = publicCapabilityLabel({ publicAgent: item.agent, access: item.access });
        return joinDisplay([handle, capability, item.purpose, item.agentId, item.source, item.reason]);
    });
    return expanded ? [summary, ...agents, `noticeId: ${notice.noticeId}`].join("\n") : summary;
}
export function renderTuiNotice(notice: TuiNotice, expanded: boolean, theme: ExtensionContext["ui"]["theme"], words?: readonly string[]): Component {
    return { invalidate() {}, render(width: number) { const text = theme.fg(notice.kind === "explicit-stop" ? "warning" : "accent", tuiNoticeText(notice, expanded, words)); return wrapTextWithAnsi(text, Math.max(1, width)).map(line => truncateToWidth(line, Math.max(1, width), "")); } };
}

type MeshSendParameters = { agent?: string; access?: "read" | "write"; agentId?: string; purpose?: string; message: string };
const purposeParameter = Type.String({ description: "Short display name for this task. Required for a new child or idle reuse. Follow-ups may omit it and never change the stored purpose." });
const sendParametersFor = (targets: Readonly<Record<string, ChildDefinition>>) => {
    const message = Type.String({ minLength: 1 });
    const policy = { targets: Object.keys(targets) };
    const variants = resolveAuthorizedSelectors(policy, targets).map(route => Type.Object({ agent: Type.Literal(route.selector.agent, { description: route.definition.description }), access: Type.Literal(route.selector.access, { description: route.selector.access === "write" ? "Change source and configuration." : "Leave source and configuration unchanged." }), purpose: purposeParameter, message }, { additionalProperties: false }));
    variants.push(Type.Object({ agentId: Type.String(), purpose: Type.Optional(purposeParameter), message }, { additionalProperties: false }) as never);
    return { ...Type.Union(variants), type: "object" as const };
};
const outputMode = () => Type.Optional(StringEnum(["compact", "full"] as const, { default: "compact", description: "Terminal result projection; compact may advertise fullOutputAvailable." }));
const getParameters = Type.Object({ taskId: Type.String(), outputMode: outputMode() }, { additionalProperties: false });
const endResponseParameters = Type.Object({}, { additionalProperties: false });
const controlParameters = Type.Object({ agentId: Type.String(), action: StringEnum(["pause", "interrupt", "resume"] as const) }, { additionalProperties: false });
const stopParameters = Type.Object({ agentId: Type.Optional(Type.String()), taskId: Type.Optional(Type.String()), reason: Type.Optional(Type.String()) }, { additionalProperties: false });
const reportParameters = Type.Object({ summary: Type.String({ minLength: 1 }) }, { additionalProperties: false });
type SendSelector = { kind: "new"; agent: string; access: "read" | "write" } | { kind: "existing"; agentId: string };
function exactSelector(value: MeshSendParameters, tool: string): SendSelector { if (value.agentId !== undefined) { if (value.agent !== undefined || value.access !== undefined) throw new Error(`${tool} agentId cannot be combined with capability selection`); return { kind: "existing", agentId: value.agentId }; } if (value.agent === undefined) throw new Error(`${tool} requires agent or agentId`); if (value.access !== "read" && value.access !== "write") throw new Error(`${tool} requires access read or write for a new agent`); return { kind: "new", agent: value.agent, access: value.access }; }
function canonicalMeshSendArguments(params: MeshSendParameters, purpose: string | undefined): unknown {
    if (params.agentId !== undefined) return purpose === undefined ? { agentId: params.agentId, message: params.message } : { agentId: params.agentId, purpose, message: params.message };
    return { agent: params.agent, access: params.access, purpose, message: params.message };
}

type Accounting = { usage?: Usage; claimedTaskIds: string[]; receiptIds: string[]; receivedTaskIds: string[] };
const emptyAccounting = (): Accounting => ({ claimedTaskIds: [], receiptIds: [], receivedTaskIds: [] });
type TerminalReception = { snapshots: AgentSnapshot[]; accounting: Accounting };
async function receiveTerminalSnapshots(config: SubagentRuntimeConfig, caller: ActiveCaller, toolCallId: string, canonicalArguments: unknown, rawSnapshots: readonly AgentSnapshot[], receiptResult?: CompletionReceiptCreationResult, signal?: AbortSignal): Promise<TerminalReception> {
    signal?.throwIfAborted();
    let snapshots = rawSnapshots.map(sanitizeSnapshot);
    for (const snapshot of snapshots) if (!snapshot.task?.result || !isTerminalTask(snapshot.task.status.state)) throw new Error(`Task ${snapshot.task?.request.taskId ?? "unknown"} is not terminal`);
    const routed = snapshots.filter(snapshot => snapshot.task?.request.completion !== undefined);
    if (routed.length !== 0 && routed.length !== snapshots.length) throw new Error("mesh_get cannot combine routed and historical tasks");
    if (!caller.sessionFile) { if (routed.length) throw new Error("mesh_get requires a durable caller session"); return { snapshots, accounting: emptyAccounting() }; }
    const mesh = await readMesh(config.stateRoot, caller.meshId);
    signal?.throwIfAborted();
    let receipt = receiptResult;
    if (!receipt && routed.length) receipt = await createCompletionReceipt(config.stateRoot, caller.meshId, { endpointId: caller.endpointId, endpointSessionFile: caller.sessionFile, claimantSessionFile: caller.sessionFile, toolCallId, toolName: "mesh_get", canonicalArguments, taskIds: snapshots.map(snapshot => snapshot.task!.request.taskId), maxTasksPerMesh: mesh.budgets.maxTasksPerMesh });
    if (receipt?.receipt && !receipt.created && receipt.receipt.taskIds.some((taskId, index) => snapshots[index]?.task?.request.taskId !== taskId)) snapshots = await Promise.all(receipt.receipt.taskIds.map(async taskId => { const task = await readTask(config.stateRoot, caller.meshId, taskId); authorizeTask(caller, task, "retry receipt task"); return sanitizeSnapshot(await readAgentSnapshot(config.stateRoot, caller.meshId, task.request.agentId, taskId)); }));
    const newlyReceived = receipt ? new Set(receipt.receivedTaskIds) : new Set(snapshots.map(snapshot => snapshot.task!.request.taskId));
    const claimedTaskIds: string[] = [];
    try {
        signal?.throwIfAborted();
        for (const snapshot of snapshots) { serializeModelVisibleJson(projectMinimalAgentTask(snapshot)); serializeModelVisibleJson(projectDebugSnapshot(snapshot)); }
        serializeModelVisibleJson({ tasks: snapshots.map(projectMinimalAgentTask) });
        for (const snapshot of snapshots) {
            signal?.throwIfAborted();
            const taskId = snapshot.task!.request.taskId;
            if (!newlyReceived.has(taskId) || !snapshot.agent.capabilities.usage) continue;
            const claimed = await claimTaskUsage(config.stateRoot, caller.meshId, taskId, caller.sessionFile, { source: "tool", toolCallId, toolName: "mesh_get" });
            signal?.throwIfAborted();
            if (claimed.created) claimedTaskIds.push(taskId);
        }
        signal?.throwIfAborted();
    } catch (error) {
        if (receipt?.created && receipt.receipt) await rollbackCompletionReceipt(config.stateRoot, caller.meshId, { endpointId: caller.endpointId, endpointSessionFile: caller.sessionFile, receiptId: receipt.receipt.receiptId }).catch(() => {});
        throw error;
    }
    const accounting: Accounting = { claimedTaskIds, receiptIds: receipt?.receipt ? [receipt.receipt.receiptId] : [], receivedTaskIds: receipt?.receivedTaskIds ?? [] };
    return { snapshots, accounting };
}
function agentResult(raw: AgentSnapshot, accounting: Accounting, debug = false, outputMode: MeshOutputMode = "compact") { const snapshot = sanitizeSnapshot(raw); const details: AgentToolDetails = { ...snapshot, accounting }; const projected = debug ? projectDebugSnapshot(snapshot) : snapshot.task?.result && isTerminalTask(snapshot.task.status.state) ? projectMeshRetrievalTask(snapshot, outputMode) : projectMinimalAgentTask(snapshot); return { content: [{ type: "text" as const, text: serializeModelVisibleJson(projected, { fullOutputAvailableOnTruncation: !debug && outputMode === "compact" }) }], details }; }
function attachDisplayIdentities<T extends object>(details: T, identities: Record<string, AgentDisplayIdentity>): T & { identities: Record<string, AgentDisplayIdentity> } {
    return { ...details, identities };
}
function attachDirectionalIdentities<T extends object>(details: T, snapshot: AgentSnapshot, words?: readonly string[], extras: readonly AgentDisplayIdentity[] = []): T & { displayIdentity: AgentDisplayIdentity; identities: Record<string, AgentDisplayIdentity> } {
    const child = displayIdentityForSnapshot(snapshot, words);
    const identities: Record<string, AgentDisplayIdentity> = { [child.agentId]: child };
    for (const extra of extras) identities[extra.agentId] = extra;
    return { ...details, displayIdentity: child, identities };
}
function identityFromCaller(caller: ActiveCaller, words?: readonly string[]): AgentDisplayIdentity | undefined {
    if (!caller.agentId) return undefined;
    const selector = caller.envelope?.self.selector;
    return {
        agentId: caller.agentId,
        handle: handleForAgentId(caller.agentId, words),
        ...(selector ? { publicAgent: selector.agent, access: selector.access } : {}),
    };
}
async function liveCompletionTarget(config: SubagentRuntimeConfig, caller: ActiveCaller): Promise<CompletionTarget> { if (!caller.sessionFile) throw new Error("mesh_send requires a durable caller session"); const endpoint = await resolveRouteEndpoint(config.stateRoot, caller.meshId, "self", caller.agentId); if (!endpoint.online || endpoint.endpointId !== caller.endpointId || endpoint.sessionFile !== caller.sessionFile || !await isLiveMeshEndpointBinding(config.stateRoot, caller.meshId, endpoint)) throw new Error("mesh_send requires a live durable self endpoint"); return { endpointId: caller.endpointId, endpointSessionFile: caller.sessionFile, bindingId: endpoint.bindingId }; }
async function stopPreparedLaunch(deps: OrchestrationDependencies, tmuxCommand: string, tmux: NonNullable<Awaited<ReturnType<typeof launchAgentSession>>>): Promise<void> { let stopFailure: unknown; try { if (await stopAgentSession(deps.exec, tmuxCommand, tmux)) return; } catch (error) { stopFailure = error; } const inspected = await inspectAgentTmux(deps.exec, tmuxCommand, tmux).catch(error => { stopFailure ??= error; return undefined; }); const confirmed = inspected && (inspected.server === "absent" || inspected.server === "mismatch" || inspected.server === "match" && inspected.paneState === "dead"); if (!confirmed) throw new Error("Could not confirm that the pre-publication agent process stopped", { cause: stopFailure }); }

async function startAgentSubmission(deps: OrchestrationDependencies, config: SubagentRuntimeConfig, capturedCaller: ActiveCaller, params: MeshSendParameters & { childId: string; completion: CompletionTarget; agentId: string; taskId: string; purpose: string }, signal: AbortSignal | undefined, ctx: ExtensionContext): Promise<AgentSnapshot> {
    if (signal?.aborted) throw signal.reason;
    // Cross the current authority barrier again immediately before capacity reservation.
    // Everything persisted below is derived from this current caller, never the earlier tool snapshot.
    const caller = await reauthorizeCaller(deps, capturedCaller);
    const resolved = resolveSelectedCapability(caller, { agent: params.agent!, access: params.access! }, "start");
    const { childId, definition } = resolved;
    if (childId !== params.childId) throw new Error("Capability route changed before dispatch");
    const profile = definition.execution;
    const resolvedCursorAcpModelId = resolveCursorAcpModelId(config, profile);
    const harness = resolveHarnessAdapter(config, profile.harness, profile);
    const gc = meshGcConfig(config.gc, caller.catalog);
    const reservation = caller.agentId
        ? await awaitPressureAdmission(config.stateRoot, caller.meshId, { requestId: randomUUID(), requesterAgentId: caller.agentId, requesterRuntimeId: caller.runtimeId ?? "", expectedBinding: { endpointId: caller.endpointId, endpointSessionFile: caller.sessionFile! }, signal, sleep: milliseconds => (deps.sleep ?? sleep)(milliseconds) })
        : await reserveNewAgentCapacityWithPressure({ stateRoot: config.stateRoot, meshId: caller.meshId, leaseId: deps.rootLeaseId?.() ?? "", gc, exec: deps.exec, tmux: config.tmux, expectedCurrentEpochId: caller.epoch.epochId }, undefined, undefined, undefined, { endpointId: caller.endpointId, endpointSessionFile: caller.sessionFile! });
    try { await reauthorizeReservedCaller(deps, caller); } catch (error) { await releaseMeshReservation(config.stateRoot, caller.meshId, reservation.reservationId, "authority changed after reservation"); throw error; }
    const { agentId, taskId } = params; const tmuxContext = await probeTmux(deps.exec, config.tmux, deps.env); if (!tmuxContext) { await releaseMeshReservation(config.stateRoot, caller.meshId, reservation.reservationId, "tmux unavailable"); throw new Error("Mesh agent start requires a usable current tmux context"); }
    let initialCandidateIndex = 0; let modelRoute: import("./utilities/orchestration_profile_fallback.ts").ModelRouteState | undefined;
    if (profile.harness === "pi") {
        if (!ctx.modelRegistry) { await releaseMeshReservation(config.stateRoot, caller.meshId, reservation.reservationId, "model registry unavailable"); throw new Error("Mesh Pi launch requires a model registry"); }
        const selected = await preflightProfileCandidates({ profile, profileName: childId, registry: ctx.modelRegistry });
        if (!selected.ok) { await releaseMeshReservation(config.stateRoot, caller.meshId, reservation.reservationId, "profile candidate preflight exhausted"); throw new Error("route_exhausted"); }
        initialCandidateIndex = selected.route.activeIndex;
        modelRoute = selected.route;
    } else {
        modelRoute = initialModelRoute(profile, 0);
        initialCandidateIndex = 0;
    }
    const children = callerChildren(caller); const childExtensions = Object.fromEntries(Object.keys(children).map(name => [name, caller.envelope?.childExtensions[name] ?? buildChildExtensionManifest(config, children[name]?.contextPolicy ?? "project", children[name]?.childExtensionContributions ?? [])]));
    const envelope = caller.envelope
        ? projectLaunchEnvelope(params.childId, agentId, caller.envelope, initialCandidateIndex)
        : buildLaunchEnvelope({ meshId: caller.meshId, agentId, epochId: caller.epoch.epochId, childId: params.childId, snapshot: caller.epoch, childExtensions, initialCandidateIndex });
    const prepared = await prepareAgent(config.stateRoot, caller.meshId, { reservationId: reservation.reservationId, agentId, childId: params.childId, harness: profile.harness, cwd: ctx.cwd, definitionSnapshot: definition, launchEnvelope: "pending", epochId: caller.epoch.epochId, provenance: { parentAgentId: caller.agentId, creatorSessionId: ctx.sessionManager.getSessionId(), ...(caller.sessionFile ? { creatorSessionFile: caller.sessionFile } : {}) }, capabilities: harness.adapter.capabilities, authority: dispatchAuthority(caller, params.childId), modelRoute });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json"); let tmux; let published = false; let taskCreated = false;
    try {
        await writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
        const launch = harness.adapter.launch(config, harness.harness, { meshId: caller.meshId, agentId, agentDirectory: prepared.paths.directory, childId: params.childId, taskPath: taskPaths(config.stateRoot, caller.meshId, taskId).directory, launchEnvelope: envelopePath, epochSnapshot: envelope, cwd: ctx.cwd, ...(resolvedCursorAcpModelId ? { resolvedCursorAcpModelId } : {}) });
        await assertExpectedEndpointBinding(config.stateRoot, caller.meshId, { endpointId: caller.endpointId, endpointSessionFile: caller.sessionFile! });
        tmux = await launchAgentSession(deps.exec, config.tmux, tmuxContext, { meshId: caller.meshId, epochId: caller.epoch.epochId, agentId, agent: definition.selector.agent, access: definition.selector.access, handle: handleForAgentId(agentId, config.natureHandleWords), cwd: ctx.cwd, launch });
        await publishAgent(config.stateRoot, caller.meshId, prepared.paths, { agentId, epochId: caller.epoch.epochId, childId: params.childId, harness: profile.harness, ...(resolvedCursorAcpModelId ? { cursorAcpModelId: resolvedCursorAcpModelId } : {}), cwd: ctx.cwd, definitionSnapshot: definition, launchEnvelope: envelopePath, tmux, tmuxOwnership: "mesh-hub", capabilities: harness.adapter.capabilities, parentAgentId: caller.agentId, creatorSessionId: ctx.sessionManager.getSessionId(), ...(caller.sessionFile ? { creatorSessionFile: caller.sessionFile } : {}) }, dispatchAuthority(caller, params.childId)); published = true;
        const task = await createTask(config.stateRoot, caller.meshId, agentId, { prompt: params.message, purpose: params.purpose }, { ...requester(caller), completion: params.completion }, reservation.reservationId, taskId, dispatchAuthority(caller, params.childId)); taskCreated = true; let snapshot = await readAgentSnapshot(config.stateRoot, caller.meshId, agentId, task.request.taskId);
        const deadline = (deps.now ?? (() => performance.now()))() + (harness.harness.bridgeReadyTimeoutMs ?? 5000); while ((deps.now ?? (() => performance.now()))() < deadline) { if (signal?.aborted) throw signal.reason; snapshot = await readAgentSnapshot(config.stateRoot, caller.meshId, agentId, taskId); if (isTerminalAgent(snapshot.status.state)) throw new Error(snapshot.status.exitReason ?? `Agent became ${snapshot.status.state} during startup`); if (snapshot.status.bridgeReady) return readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, caller.meshId, agentId, taskId); await (deps.sleep ?? sleep)(50, signal); } throw new Error("Agent bridge readiness timed out");
    } catch (error) {
        const internalNames = [params.childId, ...configuredModelDiagnosticNames(profile.models, resolvedCursorAcpModelId)];
        const publicError = sanitizeModelVisibleError(error, internalNames);
        let cleanupError: unknown;
        if (published) try { await failStartedMeshAgent({ stateRoot: config.stateRoot, meshId: caller.meshId, agentId, exec: deps.exec, tmux: config.tmux }, errorText(error)); } catch (failure) { cleanupError = failure; }
        else { let confirmed = tmux === undefined && !(error instanceof AgentLaunchCleanupError); if (tmux) try { await stopPreparedLaunch(deps, config.tmux, tmux); confirmed = true; } catch (failure) { cleanupError = failure; } else if (!confirmed) cleanupError = error; if (confirmed) await removePreparedAgent(config.stateRoot, caller.meshId, agentId, reservation.reservationId, "launch failed"); }
        if (cleanupError) throw new Error(`${publicError}; cleanup for agent ${agentId} remains incomplete: ${sanitizeModelVisibleError(cleanupError, internalNames)}`, { cause: error }); if (!taskCreated) await releaseMeshReservation(config.stateRoot, caller.meshId, reservation.reservationId, "launch failed before task commit").catch(() => {}); throw new Error(publicError, { cause: error });
    }
}

type StagedMeshSendActivation = (caller: ActiveCaller) => Promise<void>;
function meshNextAction() { return meshYieldNextAction(); }
function submittedSendResult(raw: AgentSnapshot) { const snapshot = sanitizeSnapshot(raw); const details: SubmitDetails = { ...snapshot, accounting: emptyAccounting() }; return { content: [{ type: "text" as const, text: serializeModelVisibleJson({ disposition: "submitted", ...projectMinimalSubmitResult(snapshot), nextAction: meshNextAction() }) }], details }; }
function intervenedSendResult(result: Extract<MeshSendResult, { disposition: "intervened" }>, snapshot: AgentSnapshot, words?: readonly string[], routing?: { fromEndpointId: string; toEndpointId: string }, callerIdentity?: AgentDisplayIdentity) {
    return { content: [{ type: "text" as const, text: serializeModelVisibleJson({ ...result, nextAction: meshNextAction() }) }], details: attachDirectionalIdentities({ ...result, ...routing }, snapshot, words, callerIdentity ? [callerIdentity] : []) };
}
export function createMeshSendTool(deps: OrchestrationDependencies, targets: Readonly<Record<string, ChildDefinition>> = {}, stagedActivation?: StagedMeshSendActivation): ToolDefinition { return defineTool({ name: "mesh_send", label: "Send mesh work", description: "Create an authorized task or durably intervene in a direct child’s active task, then follow the returned nextAction.", promptSnippet: "Send mesh work", promptGuidelines: ["For a new mesh_send, select an authorized agent, set access to read or write, and give a short purpose for that new task. Follow-ups to an active task may omit purpose and never change it. After submission, continue useful independent work and follow nextAction. Yield with a standalone end_response call; orchestration keeps the run open while delegated work remains."], parameters: sendParametersFor(targets), executionMode: "sequential", renderCall: renderSendCall, renderResult: (result, options, theme, context) => renderSendResult(result, options, theme, context, deps.natureHandleWords?.()), async execute(toolCallId, rawParams, signal, _update, ctx) { const params = rawParams as MeshSendParameters; const target = exactSelector(params, "mesh_send"); const purpose = optionalTaskPurpose(params.purpose); if (target.kind === "new" && purpose === undefined) throw new Error("mesh_send new child requires purpose"); const canonicalArguments = canonicalMeshSendArguments(params, purpose); const config = await loadOrchestrationConfig(deps.configPath); const caller = await authorized(deps); if (target.kind === "new") resolveSelectedCapability(caller, target, "start"); const completion = await liveCompletionTarget(config, caller); let storedTarget: AgentSnapshot | undefined; if (target.kind === "existing") { rejectSelfAgent(caller, target.agentId, "send"); storedTarget = await readAgentSnapshot(config.stateRoot, caller.meshId, target.agentId); authorizeAgent(caller, storedTarget, "send to"); authorizeReuse(caller, storedTarget); }
        const mutationCaller = stagedActivation ? await reauthorizeCaller(deps, caller) : caller; await stagedActivation?.(mutationCaller);
        if (target.kind === "new") { const selected = resolveSelectedCapability(mutationCaller, target, "start"); const reservation = await reserveNewAgentMeshSendSubmission(config.stateRoot, mutationCaller.meshId, { callerEndpointId: mutationCaller.endpointId, callerEndpointSessionFile: mutationCaller.sessionFile!, toolCallId, canonicalArguments }); if (!reservation.created) { const task = await readTask(config.stateRoot, mutationCaller.meshId, reservation.result.taskId).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(error)); if (task) { deps.trackWaitTask?.(mutationCaller, task.request.taskId); return submittedSendResult(await readAgentSnapshot(config.stateRoot, mutationCaller.meshId, task.request.agentId, task.request.taskId)); } }
            const snapshot = await startAgentSubmission(deps, config, mutationCaller, { ...params, childId: selected.childId, completion, agentId: reservation.result.agentId, taskId: reservation.result.taskId, purpose: purpose! }, signal, ctx); deps.trackWaitTask?.(mutationCaller, snapshot.task!.request.taskId); return submittedSendResult(snapshot); }
        authorizeAgent(mutationCaller, storedTarget!, "send to"); authorizeReuse(mutationCaller, storedTarget!); const endpoint = storedTarget!.agent.capabilities.interactiveInterventions ? await resolveRouteEndpoint(config.stateRoot, mutationCaller.meshId, target.agentId) : undefined; const result = await registerStateAwareMeshSend(config.stateRoot, mutationCaller.meshId, { callerEndpointId: mutationCaller.endpointId, callerEndpointSessionFile: mutationCaller.sessionFile!, toolCallId, canonicalArguments, ...(endpoint ? { endpoint } : {}), agentId: target.agentId, message: params.message, ...(purpose !== undefined ? { purpose } : {}), completion, authority: dispatchAuthority(mutationCaller, storedTarget!.agent.childId) });
        if (result.disposition === "intervened") return intervenedSendResult(result, storedTarget!, deps.natureHandleWords?.(), { fromEndpointId: mutationCaller.endpointId, toEndpointId: `agent:${result.agentId}` }, identityFromCaller(mutationCaller, deps.natureHandleWords?.()));
        deps.trackWaitTask?.(mutationCaller, result.taskId); return submittedSendResult(await readAgentSnapshot(config.stateRoot, mutationCaller.meshId, result.agentId, result.taskId));
    } }); }
export function createMeshGetTool(deps: OrchestrationDependencies): ToolDefinition<typeof getParameters, unknown> { return defineTool({ name: "mesh_get", label: "Get mesh task result", description: "Receive one terminal mesh task result; pending tasks return not-ready with a nextAction instead of a receipt.", promptSnippet: "Receive a terminal mesh result", promptGuidelines: ["Use mesh_get after an identity-only completion delivery, or with outputMode full when a compact notification left fullOutputAvailable. Skip an immediate mesh_get when resultIncluded is true. If resultAvailable is false, follow nextAction rather than polling."], parameters: getParameters, executionMode: "sequential", prepareArguments: args => prepareRetrievalArguments<Static<typeof getParameters>>(args), renderCall: renderGetCall, renderResult: (result, options, theme, context) => renderAgentToolResult(result, options, theme, context, deps.natureHandleWords?.()), async execute(id, params, signal) { const config = await loadOrchestrationConfig(deps.configPath); const caller = await authorized(deps); const record = await readTask(config.stateRoot, caller.meshId, params.taskId); authorizeTask(caller, record, "inspect"); const snapshot = await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, caller.meshId, record.request.agentId, params.taskId); const terminal = Boolean(snapshot.task?.result && isTerminalTask(snapshot.task.status.state)); if (!terminal) return { content: [{ type: "text" as const, text: serializeModelVisibleJson({ taskId: params.taskId, taskState: snapshot.task?.status.state ?? "created", resultAvailable: false, nextAction: meshNextAction() }) }], details: sanitizeSnapshot(snapshot) };
        const reception = await receiveTerminalSnapshots(config, caller, id, canonicalRetrievalArguments(params), [snapshot], undefined, signal);
        for (const taskId of reception.accounting.receivedTaskIds) deps.untrackWaitTask?.(caller, taskId);
        return agentResult(reception.snapshots[0]!, reception.accounting, false, params.outputMode ?? "compact"); } }); }

export function createEndResponseTool(deps: OrchestrationDependencies): ToolDefinition<typeof endResponseParameters, unknown> {
    return defineTool({
        name: END_RESPONSE_TOOL_NAME,
        label: "End response",
        description: "End the current model response without declaring task success. Call it alone so orchestration can wait for remaining delegated work.",
        promptSnippet: "Yield the current response",
        promptGuidelines: ["Continue useful independent work after delegation. Yield with a standalone end_response call; orchestration keeps the run open while delegated work or queued notifications remain. Do not mix end_response with other tools in the same batch."],
        parameters: endResponseParameters,
        executionMode: "sequential",
        renderCall: renderEndResponseCall,
        renderResult: renderEndResponseResult,
        async execute(toolCallId, _params, signal) {
            signal?.throwIfAborted();
            const batch = deps.currentBatchTools?.();
            const mixed = Boolean(batch && batch.size > 0 && (batch.size !== 1 || batch.get(toolCallId) !== END_RESPONSE_TOOL_NAME));
            if (mixed) {
                const details = { kind: END_RESPONSE_TOOL_NAME, error: END_RESPONSE_ERROR_STANDALONE, toolCallId };
                return { content: [{ type: "text" as const, text: serializeModelVisibleJson(details) }], details };
            }
            const details = { kind: END_RESPONSE_TOOL_NAME, toolCallId, ended: true as const };
            return { content: [{ type: "text" as const, text: serializeModelVisibleJson({ ended: true }) }], details, terminate: true };
        },
    });
}

export function createMeshControlTool(deps: OrchestrationDependencies): ToolDefinition<typeof controlParameters, unknown> {
    return defineTool({
        name: MESH_CONTROL_TOOL_NAME,
        label: "Control mesh execution",
        description: "Pause, interrupt, or resume a direct child and its descendants without finishing their tasks.",
        promptSnippet: "Pause, interrupt, or resume a child",
        promptGuidelines: ["Use mesh_control on a direct child you are authorized to manage. Pause holds new model and tool work. Interrupt cancels the current run while keeping the task. Resume continues the same task. Usage-limit holds require an explicit user resume."],
        parameters: controlParameters,
        executionMode: "sequential",
        renderCall: renderControlCall,
        renderResult: renderControlResult,
        async execute(toolCallId, params, signal) {
            signal?.throwIfAborted();
            const config = await loadOrchestrationConfig(deps.configPath);
            const caller = await authorized(deps);
            rejectSelfAgent(caller, params.agentId, "control");
            const stored = await readAgentSnapshot(config.stateRoot, caller.meshId, params.agentId);
            authorizeAgent(caller, stored, "control");
            const result = await (deps.applyControl?.(caller, params.agentId, params.action, "peer") ?? Promise.resolve(unsupportedControl(params.agentId, params.action)));
            return { content: [{ type: "text" as const, text: serializeModelVisibleJson({ requestId: result.requestId, action: params.action, targets: result.targets.map(target => ({ agentId: target.agentId, status: target.status, phase: target.phase })) }) }], details: result };
        },
    });
}
function unsupportedControl(agentId: string, action: ControlAction) {
    return { requestId: randomUUID(), action, targets: [{ agentId, status: "unavailable" as const, phase: "unavailable" as const }] };
}

export function createMeshStopTool(deps: OrchestrationDependencies): ToolDefinition<typeof stopParameters, unknown> { return defineTool({ name: "mesh_stop", label: "Stop mesh task or agent", description: "Stop one task or agent; stopping a task leaves its agent reusable.", promptSnippet: "Stop a mesh task or agent", parameters: stopParameters, executionMode: "sequential", prepareArguments: args => asRecord(args) as Static<typeof stopParameters>, renderCall: renderStopCall, renderResult: (result, options, theme, context) => renderStopResult(result, options, theme, context, deps.natureHandleWords?.()), async execute(id, params) { const hasAgent = params.agentId !== undefined; const hasTask = params.taskId !== undefined; if (hasAgent === hasTask) throw new Error("mesh_stop requires exactly one of agentId or taskId"); if (hasTask && params.reason !== undefined) throw new Error("mesh_stop taskId rejects reason"); const config = await loadOrchestrationConfig(deps.configPath); const caller = await authorized(deps); let snapshot: AgentSnapshot; let disposition; if (params.agentId) { rejectSelfAgent(caller, params.agentId, "stop"); const stored = await readAgentSnapshot(config.stateRoot, caller.meshId, params.agentId); authorizeAgent(caller, stored, "stop"); const reason = validateStopReason(params.reason ?? "Stopped by mesh peer"); const result = await stopMeshAgentWithDisposition({ stateRoot: config.stateRoot, meshId: caller.meshId, agentId: params.agentId, exec: deps.exec, tmux: config.tmux, source: "peer", reason, requesterEndpointId: caller.endpointId }); snapshot = result.snapshot; disposition = result.disposition; } else { const task = await readTask(config.stateRoot, caller.meshId, params.taskId!); authorizeTask(caller, task, "stop"); const result = await stopMeshTaskWithDisposition({ stateRoot: config.stateRoot, meshId: caller.meshId, taskId: params.taskId!, requesterEndpointId: caller.endpointId }); snapshot = result.snapshot; disposition = result.disposition; } const sanitized = sanitizeSnapshot(snapshot); const details = { ...sanitized, accounting: { claimedTaskIds: [] }, stopDisposition: disposition }; return { content: [{ type: "text" as const, text: serializeModelVisibleJson({ agentId: sanitized.agent.agentId, ...publicCapabilityFields(sanitized), agentState: sanitized.status.state, ...(sanitized.task ? { taskId: sanitized.task.request.taskId, taskState: sanitized.task.status.state } : {}), stopDisposition: disposition }) }], details }; } }); }

export function createMeshReportTool(deps: OrchestrationDependencies): ToolDefinition<typeof reportParameters, unknown> { return defineTool({ name: MESH_REPORT_TOOL_NAME, label: "Report mesh progress", description: "Report a decision-relevant progress summary to the direct parent of the active task.", promptSnippet: "Report mesh progress", promptGuidelines: ["Send mesh_report only when the parent requests progress or intermediate evidence can change its decision. Use the final task response for completion; a report is not a heartbeat or a synchronous question."], parameters: reportParameters, executionMode: "sequential", prepareArguments: args => asRecord(args) as Static<typeof reportParameters>, renderCall: renderReportCall, renderResult: (result, options, theme, context) => renderReportResult(result, options, theme, context, deps.natureHandleWords?.()), async execute(toolCallId, params) { const config = await loadOrchestrationConfig(deps.configPath); const caller = await authorized(deps); if (!caller.agentId || !caller.sessionFile) throw new Error("mesh_report is available only to a durable child active task"); const callerSnapshot = await readAgentSnapshot(config.stateRoot, caller.meshId, caller.agentId); const currentTaskId = callerSnapshot.status.activeTaskId; if (!currentTaskId) throw new Error("mesh_report requires an active task"); const task = await readTask(config.stateRoot, caller.meshId, currentTaskId); if (isTerminalTask(task.status.state) || task.request.requesterAgentId === caller.agentId || !task.request.completion) throw new Error("mesh_report requires a nonterminal task with a direct parent completion route"); const parent = await resolveRouteEndpoint(config.stateRoot, caller.meshId, "parent", caller.agentId); if (!parent.online || parent.endpointId !== task.request.completion.endpointId || parent.sessionFile !== task.request.completion.endpointSessionFile) throw new Error("mesh_report direct parent endpoint is unavailable or changed"); const result = await registerMeshReport(config.stateRoot, caller.meshId, { callerEndpointId: caller.endpointId, callerEndpointSessionFile: caller.sessionFile, toolCallId, endpoint: parent, agentId: caller.agentId, taskId: currentTaskId, summary: params.summary, canonicalArguments: params }); const parentIdentity = parent.agentId ? await readAgentSnapshot(config.stateRoot, caller.meshId, parent.agentId).then(snapshot => displayIdentityForSnapshot(snapshot, deps.natureHandleWords?.()), () => displayIdentityForAgentId(parent.agentId!, deps.natureHandleWords?.())) : undefined; const details = attachDirectionalIdentities({ reportId: result.reportId, taskId: currentTaskId, state: "queued" as const, fromEndpointId: caller.endpointId, toEndpointId: parent.endpointId }, callerSnapshot, deps.natureHandleWords?.(), parentIdentity ? [parentIdentity] : []); return { content: [{ type: "text" as const, text: serializeModelVisibleJson({ reportId: result.reportId, taskId: currentTaskId, state: "queued" }) }], details }; } }); }

export async function stopPaletteMeshAgent(deps: OrchestrationDependencies, config: SubagentRuntimeConfig, request: { meshId: string; agentId: string; reason?: string }): Promise<AgentSnapshot> { const caller = await authorized(deps); const snapshot = await readAgentSnapshot(config.stateRoot, request.meshId, request.agentId); authorizeAgent(caller, snapshot, "stop"); rejectSelfAgent(caller, request.agentId, "stop"); const reason = validateStopReason(request.reason ?? "Stopped from mesh palette", "Palette stop reason"); return (await stopMeshAgentWithDisposition({ stateRoot: config.stateRoot, meshId: request.meshId, agentId: request.agentId, exec: deps.exec, tmux: config.tmux, source: "user", reason, requesterEndpointId: caller.endpointId })).snapshot; }

function authorizedMeshTools(caller: ActiveCaller): string[] { return Object.keys(callerPolicy(caller).targets).length ? [...MESH_PEER_TOOL_NAMES] : []; }
function activateMeshPeerTools(pi: ExtensionAPI, caller: ActiveCaller): void { const names = authorizedMeshTools(caller); if (!names.length) throw new Error(`${caller.identity} has no authorized mesh edges`); const all = new Set(pi.getAllTools().map(tool => tool.name)); const missing = names.filter(name => !all.has(name)); if (missing.length) throw new Error(`Mesh activation unavailable; child process restart required; tools not registered: ${missing.join(", ")}`); const current = pi.getActiveTools(); pi.setActiveTools([...new Set([...current, ...names])]); const activeNow = new Set(pi.getActiveTools()); const failed = names.filter(name => !activeNow.has(name)); if (failed.length) throw new Error(`Mesh activation incomplete: ${failed.join(", ")}`); }

export async function activateMeshPeerToolsForSend(pi: ExtensionAPI, caller: ActiveCaller, persist: () => Promise<void>): Promise<void> {
    const previous = pi.getActiveTools();
    try { activateMeshPeerTools(pi, caller); await persist(); }
    catch (error) {
        try {
            pi.setActiveTools(previous);
            const restored = pi.getActiveTools();
            if (restored.length !== previous.length || restored.some((name, index) => name !== previous[index])) throw new Error("active tool set did not return to its previous state");
        } catch (rollbackError) { throw new Error(`${errorText(error)}; mesh tool rollback failed: ${errorText(rollbackError)}`, { cause: error }); }
        throw error;
    }
}

export async function registerOrchestration(pi: ExtensionAPI, options: OrchestrationRegistrationOptions = {}): Promise<boolean> {
    let noticeWords: readonly string[] | undefined;
    pi.registerEntryRenderer(NOTICE_ENTRY, (entry, renderOptions, theme) => renderTuiNotice(entry.data as TuiNotice, renderOptions.expanded, theme, noticeWords));
    loadFeatureKeybindings("meshPalette"); loadFeatureKeybindings("tmuxPreview"); const configPath = options.configPath ?? CONFIG; const catalogPath = options.catalogPath ?? CATALOG; const modePath = options.modePath ?? (configPath === CONFIG ? MODES : join(dirname(configPath), "agent-modes.json")); const env = options.env ?? process.env; const [runtime, catalog, modes] = await Promise.all([loadOrchestrationConfig(configPath), loadChildCatalog(catalogPath), loadAgentModes(modePath)]); validateOrchestrationReferences(runtime, catalog, Object.keys(modes.modes)); noticeWords = runtime.natureHandleWords; const exec: CommandExecutor = async (command, args) => { const value = await pi.exec(command, args); return { stdout: value.stdout, stderr: value.stderr, code: value.code }; };
    pi.registerMessageRenderer("mesh-event", (message, renderOptions, theme) => renderMeshEventMessage(message, renderOptions, theme, runtime.natureHandleWords));
    let current: ActiveCaller | undefined; let rootLeaseId: string | undefined; let rootSessionId: string | undefined; let endpoint: MeshEndpoint | undefined; let sessionContext: ExtensionContext | undefined; let latestMode: ActiveModeEvent | undefined; let cadence: OrchestrationDeadlineScheduler | undefined; let completionDeliveryDeadline: number | undefined; let scheduledNow = 0; const deliveryNow = options.now ?? (options.setInterval ? () => scheduledNow : () => performance.now()); let materializationPass: Promise<void> | undefined; let pumpPass: Promise<boolean> | undefined; const armedWait = new MeshArmedWait(); let armedEndpoint: MeshEndpoint | undefined; let armedTaskId: string | undefined; const trackedWaitTasks = new Set<string>(); let recoverInjectedAfterSettle = false; let deliveryGeneration = 0; let noticePumping = false; let wakeHints: DirectoryWake[] = []; const closeWakeHints = () => { const closing = wakeHints; wakeHints = []; for (const wake of closing) void wake.close(); }; let shuttingDown = false; let lastPumpError: string | undefined; let lastNoticePumpError: string | undefined; let modeBarrier: ActiveModeBarrier; const maintenance = new AbortController(); const injectedThisRuntime = new Set<string>(); const awaitingContextEvents = new Set<string>(); const confirmedReceiptIds = new Set<string>(); const deliveredCompletionTaskIds = new Set<string>(); const appendedNotices = new Set<string>(); const notifiedNotices = new Set<string>(); const reportedNoticeErrors = new Set<string>(); let resolvedEnvelope: AgentLaunchEnvelope | undefined; const childAgentId = env.PI_MESH_AGENT_ID; const childMeshId = env.PI_MESH_ID; const childEnvironment = Boolean(env.PI_AGENT_RESOLVED_AGENT || childMeshId || childAgentId);
    if (env.PI_AGENT_RESOLVED_AGENT) try { resolvedEnvelope = validateLaunchEnvelope(JSON.parse(await readFile(env.PI_AGENT_RESOLVED_AGENT, "utf8"))); } catch (error) { current = { identity: "agent:invalid", meshId: childMeshId ?? randomUUID(), epoch: {} as PolicyEpoch, catalog, endpointId: "invalid", error: errorText(error) }; }
    const isolatedPromptOnly = resolvedEnvelope?.self.contextPolicy === "prompt-only";
    const waitBindingKey = (caller: ActiveCaller, value: MeshEndpoint) => `${caller.meshId}\0${caller.endpointId}\0${caller.sessionFile ?? ""}\0${value.bindingId}\0${caller.runtimeId ?? ""}\0${armedTaskId ?? ""}`;
    const clearWaitSession = () => { armedWait.disarm(); armedEndpoint = undefined; armedTaskId = undefined; trackedWaitTasks.clear(); cadence?.setEnabled("wait-input", false); try { sessionContext?.ui.setStatus(WAIT_STATUS, undefined); } catch {} };
    const failWait = (error: unknown) => { if (!armedWait.isArmed()) return; clearWaitSession(); const diagnostic = `Mesh wait ended: ${errorText(error)}`; try { sessionContext?.ui.setStatus(PUMP_STATUS, diagnostic); sessionContext?.ui.notify(diagnostic, "error"); } catch {} };
    const setWaitStatus = async (ctx: ExtensionContext) => {
        ctx.ui.setStatus(WAIT_STATUS, "Mesh: waiting for delegated work");
    };
    const noteAbort = () => { recoverInjectedAfterSettle = true; deliveryGeneration += 1; awaitingContextEvents.clear(); deliveredCompletionTaskIds.clear(); clearWaitSession(); };
    // Pi's hasPendingMessages counts native user queues, not sendMessage's custom Agent queue.
    const hasQueuedWaitMessages = (ctx: ExtensionContext) => ctx.hasPendingMessages() || awaitingContextEvents.size > 0;
    const batchTools = new Map<string, string>();
    const executionGate = new ProcessExecutionGate();
    const deps: OrchestrationDependencies = {
        configPath, catalogPath, modePath, env, exec,
        activeCaller: () => current,
        authorityBarrier: () => { options.onAuthorityWait?.(); return modeBarrier.wait(); },
        rootLeaseId: () => rootLeaseId,
        natureHandleWords: () => runtime.natureHandleWords,
        currentBatchTools: () => batchTools,
        trackWaitTask: (caller, taskId) => { if (!current || caller.meshId !== current.meshId || caller.endpointId !== current.endpointId || caller.sessionFile !== current.sessionFile) return; trackedWaitTasks.add(taskId); },
        untrackWaitTask: (caller, taskId) => { if (!current || caller.meshId !== current.meshId || caller.endpointId !== current.endpointId || caller.sessionFile !== current.sessionFile) return; trackedWaitTasks.delete(taskId); },
        applyControl: (caller, agentId, action, source) => applySubtreeControl(caller, agentId, action, source),
    };
    const inspectRootLease = (sessionId: string, sessionFile: string | undefined, tmux: Awaited<ReturnType<typeof probeTmux>>) => async (existing: Parameters<NonNullable<Parameters<typeof attachRootMesh>[2]["inspectExisting"]>>[0]) => { let pidAlive = true; try { process.kill(existing.pid, 0); } catch { pidAlive = false; } const sameSession = existing.rootSessionId === sessionId && existing.rootSessionFile === sessionFile; const tmuxMatches = existing.tmuxServerPid === undefined && existing.tmuxSessionId === undefined ? tmux === null : Boolean(tmux && existing.tmuxServerPid === tmux.serverPid && existing.tmuxSessionId === tmux.sessionId); return { pidAlive, sameSession, tmuxMatches }; };
    const initialPolicy = resolvedEnvelope ? { targets: resolvedEnvelope.self.targets } : { targets: [] as string[] };
    const childHasOutboundEdges = Boolean(childAgentId && !isolatedPromptOnly && initialPolicy.targets.length);
    let stagedMeshToolsEnabled = false;
    const stagedActivation: StagedMeshSendActivation | undefined = childHasOutboundEdges ? async caller => {
        if (stagedMeshToolsEnabled) return;
        await activateMeshPeerToolsForSend(pi, caller, async () => {
            const { patchAgentStatus } = await import("./utilities/orchestration_store.ts");
            await patchAgentStatus(runtime.stateRoot, caller.meshId, caller.agentId!, { meshToolsEnabled: true });
        });
        stagedMeshToolsEnabled = true;
    } : undefined;
    const registerDispatch = (targets: Record<string, ChildDefinition> = {}) => { pi.registerTool(createMeshSendTool(deps, targets, stagedActivation)); };
    const applySubtreeControl = async (caller: ActiveCaller, agentId: string, action: ControlAction, source: ControlSource) => {
        const requestId = randomUUID();
        const ids = await descendantAgentIds(runtime.stateRoot, caller.meshId, agentId);
        const targets: Array<{ agentId: string; status: ControlTargetStatus; phase: string }> = [];
        for (const targetId of ids) {
            const snapshot = await readAgentSnapshot(runtime.stateRoot, caller.meshId, targetId).catch(() => undefined);
            if (!snapshot) { targets.push({ agentId: targetId, status: "unavailable", phase: "unavailable" }); continue; }
            if (action === "pause" && snapshot.agent.harness !== "pi") {
                targets.push({ agentId: targetId, status: "unsupported", phase: projectExecutionPhase({ waiting: false, inFlightCount: 0, holds: (await readAgentExecution(runtime.stateRoot, caller.meshId, targetId))?.holds ?? [], interrupting: false, interruptConfirmed: false, unavailable: false }) });
                continue;
            }
            const execution = await readAgentExecution(runtime.stateRoot, caller.meshId, targetId).catch(() => undefined);
            const runtimeBinding = await readAgentRuntimeBinding(runtime.stateRoot, caller.meshId, targetId).catch(() => undefined);
            if (action === "resume" && !runtimeBinding) {
                targets.push({
                    agentId: targetId,
                    status: "unavailable",
                    phase: projectExecutionPhase({ waiting: false, inFlightCount: 0, holds: execution?.holds ?? [], interrupting: Boolean(execution?.interrupting), interruptConfirmed: Boolean(execution?.interruptConfirmed), unavailable: true }),
                });
                continue;
            }
            const applied = await applyAgentControl(runtime.stateRoot, caller.meshId, targetId, {
                action,
                source,
                issuer: caller.endpointId,
                expectedRevision: execution?.revision ?? 0,
                ...(runtimeBinding ? { expectedRuntimeId: runtimeBinding.runtimeId, expectedBindingId: runtimeBinding.runtimeId } : {}),
                ...(action === "resume" && source === "user" ? { clearLimitHolds: true } : {}),
            });
            if (targetId === current?.agentId) {
                if (applied.applied && action === "pause") executionGate.requestPause(applied.state.revision);
                if (applied.applied && action === "interrupt") executionGate.requestInterrupt(applied.state.revision);
                if (applied.applied && action === "resume") executionGate.resume(applied.state.revision);
            }
            targets.push({
                agentId: targetId,
                status: applied.status,
                phase: projectExecutionPhase({ waiting: armedWait.isArmed(), inFlightCount: targetId === current?.agentId ? executionGate.inFlightCount : 0, holds: applied.state.holds, interrupting: applied.state.interrupting, interruptConfirmed: applied.state.interruptConfirmed, unavailable: Boolean(applied.state.unavailable) }),
            });
        }
        return { requestId, action, targets };
    };
    if (!isolatedPromptOnly) { registerDispatch(resolvedEnvelope ? childTargets({ identity: resolvedEnvelope.identity, meshId: resolvedEnvelope.meshId, epoch: {} as PolicyEpoch, catalog, envelope: resolvedEnvelope, agentId: resolvedEnvelope.agentId, endpointId: `agent:${resolvedEnvelope.agentId}` }) : {}); pi.registerTool(createMeshGetTool(deps)); pi.registerTool(createEndResponseTool(deps)); pi.registerTool(createMeshStopTool(deps)); pi.registerTool(createMeshControlTool(deps)); pi.registerTool(createMeshReportTool(deps)); }
    const applyMode = async (event: ActiveModeEvent) => { latestMode = event; if (!sessionContext || childAgentId || !current) return; const restored = branchData<EpochBinding>(sessionContext, POLICY_BINDING); const epoch = await ensurePolicyEpoch(runtime.stateRoot, current.meshId, { mode: event.name, catalog, callPolicy: runtime.callPolicy, ...(restored?.meshId === current.meshId && restored.mode === event.name ? { restoreEpochId: restored.epochId } : {}) }); current = { ...current, identity: `mode:${event.name}`, epoch, error: undefined }; registerDispatch(childTargets(current)); if (!restored || restored.epochId !== epoch.epochId) pi.appendEntry(POLICY_BINDING, { schemaVersion: 1, meshId: current.meshId, mode: event.name, epochId: epoch.epochId, policyDigest: epoch.policyDigest } satisfies EpochBinding); };
    modeBarrier = createActiveModeBarrier(applyMode, error => { if (current) current = { ...current, error: errorText(error) }; });
    onActiveMode(pi, event => modeBarrier.enqueue(event), error => { if (current) current = { ...current, error: errorText(error) }; });
    const emitTransitionResult = (result: ParentTransitionResult) => { pi.events.emit(PARENT_TRANSITION_RESULT_EVENT, result); };
    const handleParentTransition = async (value: unknown): Promise<void> => {
        let request: ParentTransitionRequest;
        try { request = validateParentTransitionRequest(value); }
        catch (error) { if (current) current = { ...current, error: errorText(error) }; return; }
        const reject = (error: string) => emitTransitionResult({ schemaVersion: 1, requestId: request.requestId, status: "rejected", error });
        try {
            if (childAgentId || !current || !rootLeaseId || !rootSessionId || !endpoint) { reject("Mesh parent transition requires the attached root session"); return; }
            if (shuttingDown || recoverInjectedAfterSettle || armedWait.isArmed() || trackedWaitTasks.size || executionGate.inFlightCount) { reject("Mesh root is not settled for a parent transition"); return; }
            if (request.operation === "prepare") {
                if (request.kind === undefined || request.fromMode === undefined) { reject("prepare requires kind and fromMode"); return; }
                if (request.kind === "mode" && request.targetMode === undefined) { reject("mode prepare requires targetMode"); return; }
                let fence: Awaited<ReturnType<typeof prepareParentTransition>>;
                try {
                    fence = await prepareParentTransition(runtime.stateRoot, current.meshId, { requestId: request.requestId, rootLeaseId, rootSessionId, kind: request.kind, fromMode: request.fromMode, ...(request.targetMode !== undefined ? { targetMode: request.targetMode } : {}), expectedBinding: { endpointId: endpoint.endpointId, endpointSessionFile: endpoint.sessionFile, bindingId: endpoint.bindingId } });
                } catch (error) {
                    reject(errorText(error));
                    return;
                }
                emitTransitionResult({ schemaVersion: 1, requestId: request.requestId, status: "prepared", token: fence.token });
                return;
            }
            const fence = await readParentTransition(runtime.stateRoot, current.meshId);
            if (!fence || fence.token !== request.token || fence.rootLeaseId !== rootLeaseId) { reject("Parent transition fence does not match the request"); return; }
            if (request.operation === "cancel") {
                await releaseParentTransition(runtime.stateRoot, current.meshId, { token: fence.token, rootLeaseId: fence.rootLeaseId });
                emitTransitionResult({ schemaVersion: 1, requestId: request.requestId, status: "cancelled" });
                return;
            }
            if (fence.kind !== "mode" || fence.targetMode === undefined) { reject("Only mode transitions can be applied"); return; }
            const previousEpochId = current.epoch.epochId;
            try { await applyMode({ schemaVersion: 2, name: fence.targetMode, reason: "switch" } as ActiveModeEvent); }
            catch (error) {
                let rolledBack = false;
                if (previousEpochId !== undefined) {
                    try {
                        const epoch = await ensurePolicyEpoch(runtime.stateRoot, current.meshId, { mode: fence.fromMode, catalog, callPolicy: runtime.callPolicy, restoreEpochId: previousEpochId });
                        const restored: ActiveCaller = { ...current, identity: `mode:${fence.fromMode}`, epoch, error: undefined };
                        current = restored;
                        registerDispatch(childTargets(restored));
                        rolledBack = true;
                    } catch { rolledBack = false; }
                }
                const failure = rolledBack ? `Parent transition apply failed; rolled back to the previous mesh epoch. ${errorText(error)}` : `Parent transition apply failed and the epoch rollback also failed; mesh mutations remain suspended. ${errorText(error)}`;
                current = { ...current, error: failure };
                try { sessionContext?.ui.notify(failure, "error"); } catch {}
                emitTransitionResult({ schemaVersion: 1, requestId: request.requestId, status: "failed", error: failure });
                return;
            }
            await releaseParentTransition(runtime.stateRoot, current.meshId, { token: fence.token, rootLeaseId: fence.rootLeaseId });
            emitTransitionResult({ schemaVersion: 1, requestId: request.requestId, status: "applied" });
        } catch (error) {
            if (current) current = { ...current, error: errorText(error) };
            emitTransitionResult({ schemaVersion: 1, requestId: request.requestId, status: "failed", error: errorText(error) });
        }
    };
    if (!childAgentId && !isolatedPromptOnly) pi.events.on(PARENT_TRANSITION_REQUEST_EVENT, value => { void handleParentTransition(value); });
    if (!childAgentId) pi.on("session_before_tree", async (_event) => {
        if (!current) return;
        // A present or unreadable/corrupted fence blocks tree operations; a missing fence never does.
        const fencePresent = await hasParentTransitionUnlocked(runtime.stateRoot, current.meshId).catch(() => true);
        if (fencePresent) return { cancel: true };
    });
    const eventIdentityCache = new Map<string, AgentDisplayIdentity>();
    const eventDisplayIdentities = async (agentIds: readonly string[]): Promise<Record<string, AgentDisplayIdentity>> => {
        if (!current) return {};
        const meshId = current.meshId;
        const resolved = await Promise.all([...new Set(agentIds)].map(async agentId => {
            const cacheKey = `${meshId}:${agentId}`;
            const cached = eventIdentityCache.get(cacheKey);
            if (cached) return [agentId, cached] as const;
            try {
                const identity = displayIdentityForSnapshot(await readAgentSnapshot(runtime.stateRoot, meshId, agentId), runtime.natureHandleWords);
                eventIdentityCache.set(cacheKey, identity);
                return [agentId, identity] as const;
            } catch { return undefined; }
        }));
        return Object.fromEntries(resolved.filter((entry): entry is readonly [string, AgentDisplayIdentity] => entry !== undefined));
    };
    const readOptionalMeshEvent = async (eventId: string): Promise<MeshEvent | undefined> => {
        if (!current) return undefined;
        try {
            return validateMeshEvent(JSON.parse(await readFile(join(meshPaths(runtime.stateRoot, current.meshId).events, `${eventId}.json`), "utf8")), current.meshId);
        } catch { return undefined; }
    };
    type CompletionTaskDisplay = {
        taskId: string;
        agentId: string;
        fromEndpointId: string;
        toEndpointId?: string;
        purpose?: string;
        deliveryState?: string;
        preview?: string;
    };
    const completionTaskDisplay = async (task: FrozenTask, deliveryState?: string): Promise<CompletionTaskDisplay> => {
        const display: CompletionTaskDisplay = {
            taskId: task.taskId,
            agentId: task.agentId,
            fromEndpointId: `agent:${task.agentId}`,
            ...(deliveryState ? { deliveryState } : {}),
        };
        if (!current) return display;
        try {
            const record = await readTask(runtime.stateRoot, current.meshId, task.taskId);
            display.toEndpointId = record.request.requesterEndpointId;
            display.purpose = record.request.purpose;
            const preview = record.result?.error ?? record.result?.output;
            if (preview) display.preview = preview;
        } catch { /* display-only join must not fail delivery */ }
        return display;
    };
    const deliverRoutedMeshEvent = async (message: Parameters<typeof pi.sendMessage>[0], deliverAs: MeshDelivery, target: { meshId: string; endpoint: MeshEndpoint }, eventIds: readonly string[], generation: number): Promise<boolean> => {
        if (shuttingDown || recoverInjectedAfterSettle || endpoint !== target.endpoint || current?.meshId !== target.meshId) return false;
        if (!await isLiveMeshEndpointBinding(runtime.stateRoot, target.meshId, target.endpoint)) return false;
        if (shuttingDown || recoverInjectedAfterSettle || endpoint !== target.endpoint || current?.meshId !== target.meshId) return false;
        pi.sendMessage(message, { deliverAs, triggerTurn: true });
        // Record queue ownership synchronously before context or an agent_end handler can run.
        if (generation === deliveryGeneration) for (const eventId of eventIds) awaitingContextEvents.add(eventId);
        armedWait.notifyQueued("mesh-event");
        return true;
    };
    const deliverAndMarkRoutedMeshEvents = async (message: Parameters<typeof pi.sendMessage>[0], deliverAs: MeshDelivery, target: { meshId: string; endpoint: MeshEndpoint }, eventIds: readonly string[]): Promise<boolean> => {
        const generation = deliveryGeneration;
        if (!await deliverRoutedMeshEvent(message, deliverAs, target, eventIds, generation)) return false;
        await markMeshEventsInjected(runtime.stateRoot, target.meshId, target.endpoint, eventIds);
        if (generation === deliveryGeneration) for (const eventId of eventIds) injectedThisRuntime.add(eventId);
        return true;
    };
    const openCompletionDeliveryWindow = () => {
        if (completionDeliveryDeadline !== undefined) return;
        completionDeliveryDeadline = deliveryNow() + COMPLETION_DELIVERY_WINDOW_MS;
        cadence?.setEnabled("completion-delivery", true);
    };
    const closeCompletionDeliveryWindow = () => {
        completionDeliveryDeadline = undefined;
        cadence?.setEnabled("completion-delivery", false);
    };
    const pumpEvents = async (): Promise<boolean> => {
        if (isolatedPromptOnly || shuttingDown || !endpoint || !current || !endpoint.online) return false;
        const target = { meshId: current.meshId, endpoint };
        let snapshot = await readEndpointDeliverySnapshot(runtime.stateRoot, target.meshId, target.endpoint);
        if (shuttingDown) return false;
        let deliverable = snapshot.events.filter(event => !injectedThisRuntime.has(event.eventId));
        let completions = deliverable.filter(event => event.kind === "completion");
        if (completions.length && completionDeliveryDeadline === undefined) openCompletionDeliveryWindow();
        let flushCompletions = completionDeliveryDeadline !== undefined && deliveryNow() >= completionDeliveryDeadline;
        if (flushCompletions) {
            // The root settles completions once more at the fixed boundary before taking its delivery snapshot.
            await requestMaterializationPass();
            snapshot = await readEndpointDeliverySnapshot(runtime.stateRoot, target.meshId, target.endpoint);
            deliverable = snapshot.events.filter(event => !injectedThisRuntime.has(event.eventId));
            completions = deliverable.filter(event => event.kind === "completion");
            flushCompletions = completions.length > 0;
            if (!flushCompletions) closeCompletionDeliveryWindow();
        }
        const deliveryAcks = deliverable.filter(event => event.kind === "delivery-ack");
        const firstCompletionId = flushCompletions ? completions[0]?.eventId : undefined; const firstDeliveryAckId = deliveryAcks[0]?.eventId;
        for (const event of deliverable) {
            if (shuttingDown) return false;
            if (event.kind === "completion") {
                if (event.eventId !== firstCompletionId) continue;
                const sources = completions.map(source => source.payload);
                const completedById = new Map<string, FrozenTask>();
                for (const source of sources) for (const task of source.tasks as FrozenTask[]) {
                    if (completedById.has(task.taskId)) throw new Error(`Completion task ${task.taskId} appears in multiple source events`);
                    completedById.set(task.taskId, task);
                }
                const pendingTasks = snapshot.pendingTasks.filter(task => !completedById.has(task.taskId));
                const fromWait = armedWait.currentState === "armed-waiting";
                const fromIdle = Boolean(sessionContext?.isIdle()) && armedWait.currentState === "disarmed";
                const includeResults = (fromWait || fromIdle) && armedWait.peekWakeOrigin() !== "user";
                const deliveryId = randomUUID();
                const wakeId = randomUUID();
                const packedViews: Array<Record<string, unknown>> = [];
                const packedFullIds: string[] = [];
                const packedEventIds: string[] = [];
                const packedTaskIds: string[] = [];
                if (includeResults) {
                    const items: Array<{ taskId: string; eventId: string; full: Record<string, unknown>; identity: Record<string, unknown> }> = [];
                    for (const source of completions) {
                        const eventTasks = (source.payload.tasks as FrozenTask[]).filter(task => !deliveredCompletionTaskIds.has(task.taskId));
                        if (!eventTasks.length) { packedEventIds.push(source.eventId); continue; }
                        for (const task of eventTasks) {
                            const snapshotForTask = current?.sessionFile ? await readAgentSnapshot(runtime.stateRoot, current.meshId, task.agentId, task.taskId).catch(() => undefined) : undefined;
                            const projected = snapshotForTask?.task?.result ? projectMeshRetrievalTask(sanitizeSnapshot(snapshotForTask), "compact") : { taskId: task.taskId, agentId: task.agentId, taskState: task.state };
                            items.push({ taskId: task.taskId, eventId: source.eventId, full: { ...projected, resultIncluded: true }, identity: { taskId: task.taskId, agentId: task.agentId, state: task.state, resultIncluded: false } });
                        }
                    }
                    const packed = packCompactCompletionDelivery({ deliveryId, wakeId, pendingTasks, items });
                    packedViews.push(...packed.views);
                    packedFullIds.push(...packed.resultTaskIds);
                    packedEventIds.push(...packed.completeEventIds);
                    packedTaskIds.push(...packed.packedTaskIds);
                }
                const eventIds = includeResults ? packedEventIds : completions.map(source => source.eventId);
                const included = packedViews;
                const content = includeResults
                    ? serializeModelVisibleJson({ deliveryId, wakeId, wakeOrigin: "mesh-event", tasks: included, pendingTasks }, { fullOutputAvailableOnTruncation: true })
                    : JSON.stringify({ tasks: [...completedById.values()], pendingTasks });
                if (!includeResults && exceedsModelVisibleLimit(content)) throw new Error("Completion identity bundle exceeds the model-visible budget");
                if (includeResults && !packedViews.length) continue;
                const completedDisplay = await Promise.all(completions.flatMap(source => (source.payload.tasks as FrozenTask[]).map(task => completionTaskDisplay(task, source.state))));
                const pendingDisplay = await Promise.all(pendingTasks.map(task => completionTaskDisplay(task)));
                const identityIds = [
                    ...completedDisplay.flatMap(item => [item.agentId, ...collectEndpointAgentIds(item.fromEndpointId, item.toEndpointId)]),
                    ...pendingDisplay.flatMap(item => [item.agentId, ...collectEndpointAgentIds(item.fromEndpointId, item.toEndpointId)]),
                ];
                const identities = await eventDisplayIdentities(identityIds);
                const packedSourceIds = new Set(completions.filter(source => (source.payload.tasks as FrozenTask[]).some(task => packedTaskIds.includes(task.taskId))).map(source => source.eventId));
                const details = attachDisplayIdentities({ kind: "completion", sources: includeResults ? completions.filter(source => packedSourceIds.has(source.eventId) || eventIds.includes(source.eventId)).map(source => source.payload) : sources, frontier: { observedAt: snapshot.observedAt, pendingTasks }, display: { tasks: completedDisplay, pendingTasks: pendingDisplay }, ...(includeResults ? { deliveryId, wakeId, wakeOrigin: "mesh-event" as const, resultTaskIds: packedFullIds } : {}) }, identities);
                if (!await deliverAndMarkRoutedMeshEvents({ customType: "mesh-event", content, display: true, details }, event.delivery, target, eventIds)) return false;
                if (includeResults) for (const taskId of packedFullIds) deliveredCompletionTaskIds.add(taskId);
                if (!includeResults || completions.every(source => injectedThisRuntime.has(source.eventId) || eventIds.includes(source.eventId))) closeCompletionDeliveryWindow();
                continue;
            }
            if (event.kind === "delivery-ack") {
                if (event.eventId !== firstDeliveryAckId) continue;
                const eventIds = deliveryAcks.map(source => source.eventId); const payloads = deliveryAcks.map(source => source.payload); const content = serializeModelVisibleJson({ acknowledgments: payloads });
                const followups: Array<{ messageId: string; message: string }> = [];
                for (const payload of payloads) {
                    const messageIds = Array.isArray(payload.messageIds) ? payload.messageIds : [];
                    for (const messageId of messageIds) {
                        if (typeof messageId !== "string") continue;
                        const original = await readOptionalMeshEvent(messageId);
                        if (original?.kind === "intervention" && typeof original.payload.message === "string") followups.push({ messageId, message: original.payload.message });
                    }
                }
                const identityIds = [
                    ...payloads.flatMap(payload => typeof payload.agentId === "string" ? [payload.agentId] : []),
                    ...collectEndpointAgentIds(event.senderEndpointId, event.endpointId),
                ];
                const identities = await eventDisplayIdentities(identityIds);
                const details = attachDisplayIdentities({ eventIds, kind: "delivery-ack", payloads, toEndpointId: event.endpointId, deliveryState: "acknowledged", display: { followups } }, identities);
                if (!await deliverAndMarkRoutedMeshEvents({ customType: "mesh-event", content, display: true, details }, event.delivery, target, eventIds)) return false;
                continue;
            }
            const content = `[mesh-event ${event.eventId}] ${event.kind}\n${serializeModelVisibleJson(event.payload)}`;
            const agentId = typeof event.payload.agentId === "string" ? event.payload.agentId : undefined;
            const identities = await eventDisplayIdentities([
                ...(agentId ? [agentId] : []),
                ...collectEndpointAgentIds(event.senderEndpointId, event.endpointId),
            ]);
            const details = attachDisplayIdentities({ eventId: event.eventId, kind: event.kind, payload: event.payload, fromEndpointId: event.senderEndpointId, toEndpointId: event.endpointId, deliveryState: event.state }, identities);
            if (!await deliverAndMarkRoutedMeshEvents({ customType: "mesh-event", content, display: true, details }, event.delivery, target, [event.eventId])) return false;
        }
        return true;
    };
    const requestMaterializationPass = (): Promise<void> => {
        if (!rootLeaseId || !current) return Promise.resolve();
        if (materializationPass) return materializationPass;
        const pass = materializeMeshCompletionEvents(runtime.stateRoot, current.meshId, rootLeaseId); materializationPass = pass;
        const clear = () => { if (materializationPass === pass) materializationPass = undefined; };
        void pass.then(clear, clear);
        return pass;
    };
    const materializeWithDiagnostics = async (): Promise<boolean> => { try { await requestMaterializationPass(); return true; } catch (error) { failWait(error); if (!maintenance.signal.aborted) sessionContext?.ui.setStatus(PUMP_STATUS, `Mesh completion materialization: ${errorText(error)}`); return false; } };
    const requestPumpPass = (): Promise<boolean> => { if (pumpPass) return pumpPass; const pass = pumpEvents(); pumpPass = pass; const clear = () => { if (pumpPass === pass) pumpPass = undefined; }; void pass.then(clear, clear); return pass; };
    const waitBindingIsLive = async (): Promise<boolean> => {
        if (!current || !endpoint || !armedWait.isArmed(waitBindingKey(current, endpoint)) || !await isLiveMeshEndpointBinding(runtime.stateRoot, current.meshId, endpoint)) return false;
        if (current.agentId) { const child = await readAgentSnapshot(runtime.stateRoot, current.meshId, current.agentId); if (child.status.activeTaskId !== armedTaskId) return false; }
        return true;
    };
    const inspectArmedWait = async (ctx: ExtensionContext): Promise<MeshWaitInspection> => {
        if (!await waitBindingIsLive() || !current || !endpoint) return "invalid";
        if (hasQueuedWaitMessages(ctx)) return "queued";
        if (rootLeaseId) await requestMaterializationPass();
        if (!await requestPumpPass()) return "invalid";
        if (hasQueuedWaitMessages(ctx)) return "queued";
        const snapshot = await readEndpointDeliverySnapshot(runtime.stateRoot, current.meshId, endpoint);
        return trackedWaitTasks.size || snapshot.pendingTasks.length || snapshot.events.length ? "pending" : "drained";
    };
    const recoverInjectedEvents = async () => {
        if (!recoverInjectedAfterSettle || !current || !endpoint) return;
        deliveryGeneration += 1;
        try {
            // Finish the old generation while delivery is paused, then reconcile only durable unacknowledged events.
            await pumpPass?.catch(() => {});
            const snapshot = await readEndpointDeliverySnapshot(runtime.stateRoot, current.meshId, endpoint);
            for (const event of snapshot.events) injectedThisRuntime.delete(event.eventId);
            deliveredCompletionTaskIds.clear();
        } catch (error) { try { sessionContext?.ui.notify(`Mesh abort delivery recovery: ${errorText(error)}`, "error"); } catch {} }
        finally { recoverInjectedAfterSettle = false; }
        // The existing scheduler resumes asynchronous delivery after all settlement handlers finish.
    };
    const pumpWithDiagnostics = async () => { try { if (await requestPumpPass() && lastPumpError !== undefined) { lastPumpError = undefined; try { sessionContext?.ui.setStatus(PUMP_STATUS, undefined); } catch {} } } catch (error) { failWait(error); if (endpoint && current && !await isLiveMeshEndpointBinding(runtime.stateRoot, current.meshId, endpoint).catch(() => false)) closeWakeHints(); const text = errorText(error).replace(/\s+/gu, " ").trim(); if (text !== lastPumpError) { lastPumpError = text; const diagnostic = `Mesh event pump: ${text}`; try { sessionContext?.ui.setStatus(PUMP_STATUS, diagnostic); } catch {} try { sessionContext?.ui.notify(diagnostic, "error"); } catch {} } } };
    const reportNoticeError = (error: unknown) => { const text = errorText(error).replace(/\s+/gu, " ").trim(); lastNoticePumpError = text; if (reportedNoticeErrors.has(text)) return; reportedNoticeErrors.add(text); const diagnostic = `Mesh notice pump: ${text}`; try { sessionContext?.ui.setStatus(NOTICE_PUMP_STATUS, diagnostic); } catch {} try { sessionContext?.ui.notify(diagnostic, "error"); } catch {} };
    const pumpTuiNotices = async (): Promise<void> => {
        if (isolatedPromptOnly || shuttingDown || noticePumping || sessionContext?.mode !== "tui" || !endpoint || !current) return;
        noticePumping = true; let failed = false;
        try {
            if (!await isLiveMeshEndpointBinding(runtime.stateRoot, current.meshId, endpoint)) return;
            const notices = await listPendingTuiNotices(runtime.stateRoot, current.meshId, { endpointId: endpoint.endpointId });
            for (const notice of notices) try {
                if (shuttingDown || sessionContext.mode !== "tui" || !await isLiveMeshEndpointBinding(runtime.stateRoot, current.meshId, endpoint)) return;
                if (!appendedNotices.has(notice.noticeId)) { pi.appendEntry(NOTICE_ENTRY, notice); appendedNotices.add(notice.noticeId); }
                if (!notifiedNotices.has(notice.noticeId)) { sessionContext.ui.notify(tuiNoticeText(notice), "info"); notifiedNotices.add(notice.noticeId); }
                if (shuttingDown || !await isLiveMeshEndpointBinding(runtime.stateRoot, current.meshId, endpoint)) return;
                await acknowledgeDisplayedTuiNotice(runtime.stateRoot, current.meshId, notice.noticeId, { endpointId: endpoint.endpointId, binding: endpoint }, new Date().toISOString());
            } catch (error) { failed = true; reportNoticeError(error); }
            if (!failed && lastNoticePumpError !== undefined) { lastNoticePumpError = undefined; try { sessionContext.ui.setStatus(NOTICE_PUMP_STATUS, undefined); } catch {} }
        } catch (error) { reportNoticeError(error); } finally { noticePumping = false; }
    };
    if (childAgentId && !isolatedPromptOnly) pi.registerCommand("parent", { description: "Return to this mesh agent's inviter tmux window", async handler(_args, ctx) { const result = await exec(runtime.returnParentCommand, []); if (result.code !== 0) ctx.ui.notify(result.stderr.trim() || "Could not return to the inviter window", "error"); } });
    pi.on("session_start", async (_event, ctx) => {
        sessionContext = ctx; const sessionId = ctx.sessionManager.getSessionId(); const sessionFile = ctx.sessionManager.getSessionFile();
        if (childEnvironment) { if (!resolvedEnvelope || !childMeshId || !childAgentId) throw new Error("Mesh child environment requires a valid launch envelope and mesh identity"); if (resolvedEnvelope.meshId !== childMeshId || resolvedEnvelope.agentId !== childAgentId) throw new Error("Mesh child environment does not match launch envelope"); if (!sessionFile) throw new Error("Mesh child session requires a durable session file"); const binding = await bindAgentRuntime(runtime.stateRoot, childMeshId, childAgentId, { runtimeId: randomUUID(), kind: "pi", sessionId, sessionFile }); const epochRecord = await readPolicyEpoch(runtime.stateRoot, childMeshId, resolvedEnvelope.epochId); current = { identity: resolvedEnvelope.identity, meshId: childMeshId, epoch: epochRecord, catalog: { schemaVersion: 1, children: resolvedEnvelope.children }, envelope: resolvedEnvelope, agentId: childAgentId, runtimeId: binding.runtimeId, endpointId: `agent:${childAgentId}`, sessionFile }; emitResolvedAgent(pi, resolvedEnvelope); if (sessionFile && !isolatedPromptOnly) endpoint = await bindMeshEndpoint(runtime.stateRoot, childMeshId, { endpointId: current.endpointId, kind: "agent", agentId: childAgentId, harness: "pi", sessionId, sessionFile }); const childSnapshot = await readAgentSnapshot(runtime.stateRoot, childMeshId, childAgentId); stagedMeshToolsEnabled = !isolatedPromptOnly && childSnapshot.status.meshToolsEnabled; const roleTools = resolvedEnvelope.self.tools.filter(name => !MESH_PEER_TOOL_NAMES.includes(name as typeof MESH_PEER_TOOL_NAMES[number])); const staged = childHasOutboundEdges ? stagedMeshToolsEnabled ? authorizedMeshTools(current) : ["mesh_send", MESH_REPORT_TOOL_NAME] : [MESH_REPORT_TOOL_NAME]; pi.setActiveTools(isolatedPromptOnly ? [] : [...new Set([...roleTools, ...staged, END_RESPONSE_TOOL_NAME])]); if (stagedMeshToolsEnabled) { const activeTools = new Set(pi.getActiveTools()); const missing = authorizedMeshTools(current).filter(name => !activeTools.has(name)); if (missing.length) throw new Error(`Persisted mesh activation could not be restored; child process restart required: ${missing.join(", ")}`); } ctx.ui.setStatus(MESH_CHILD_IDENTITY_STATUS, formatUsualIdentityLine(childSnapshot, runtime.natureHandleWords)); if (!isolatedPromptOnly) ctx.ui.setStatus(PARENT_STATUS, runtime.parentNavigationHint); if (sessionFile) await reconcileMeshUsageClaims(runtime.stateRoot, childMeshId, sessionFile); }
        else {
            const persisted = Boolean(sessionFile); const restored = branchData<RootBinding>(ctx, ROOT_BINDING); let mesh = restored ? await readMesh(runtime.stateRoot, restored.meshId).catch(() => undefined) : undefined; if (mesh?.state === "closing" && persisted) { const recoveryTmux = await probeTmux(exec, runtime.tmux, env); const recoveryLease = await attachRootMesh(runtime.stateRoot, mesh.meshId, { rootSessionId: sessionId, budgets: runtime.budgets, ...(sessionFile ? { rootSessionFile: sessionFile } : {}), inspectExisting: inspectRootLease(sessionId, sessionFile, recoveryTmux) }); await cleanupMeshAgents({ stateRoot: runtime.stateRoot, meshId: mesh.meshId, exec, tmux: runtime.tmux, shutdownReason: "recovery", hubContext: recoveryTmux ?? undefined }); await completeMeshClose(runtime.stateRoot, mesh.meshId, recoveryLease.leaseId); mesh = undefined; } if (!mesh || mesh.state !== "open" || !mesh.recoverable || !persisted) { mesh = await initializeMesh(runtime.stateRoot, { rootSessionId: sessionId, ...(sessionFile ? { rootSessionFile: sessionFile } : {}), recoverable: persisted, budgets: runtime.budgets }); if (persisted) pi.appendEntry(ROOT_BINDING, { schemaVersion: 1, meshId: mesh.meshId } satisfies RootBinding); }
            const tmux = await probeTmux(exec, runtime.tmux, env); const lease = await attachRootMesh(runtime.stateRoot, mesh.meshId, { rootSessionId: sessionId, budgets: runtime.budgets, ...(sessionFile ? { rootSessionFile: sessionFile } : {}), ...(tmux ? { tmuxServerPid: tmux.serverPid, tmuxSessionId: tmux.sessionId } : {}), inspectExisting: inspectRootLease(sessionId, sessionFile, tmux) }); rootLeaseId = lease.leaseId; rootSessionId = sessionId; const fallbackEpoch = mesh.currentEpochId ? await readPolicyEpoch(runtime.stateRoot, mesh.meshId, mesh.currentEpochId) : { schemaVersion: POLICY_EPOCH_SCHEMA_VERSION, meshId: mesh.meshId, epochId: randomUUID(), mode: "pending", directTargets: [], children: {}, policyDigest: "", createdAt: new Date().toISOString(), childSet: [] } as PolicyEpoch; current = { identity: "mode:pending", meshId: mesh.meshId, epoch: fallbackEpoch, catalog, endpointId: `root:${mesh.meshId}`, ...(sessionFile ? { sessionFile } : {}) }; if (sessionFile) endpoint = await bindMeshEndpoint(runtime.stateRoot, mesh.meshId, { endpointId: current.endpointId, kind: "root", harness: "pi", sessionId, sessionFile }); if (latestMode) await applyMode(latestMode); await reconcileMeshState(runtime.stateRoot, mesh.meshId); if (sessionFile) await reconcileMeshUsageClaims(runtime.stateRoot, mesh.meshId, sessionFile); const protectedReservations = await reconcilePressureAdmissions(runtime.stateRoot, mesh.meshId, async requester => { const inspected = await inspectAgentTmux(exec, runtime.tmux, requester.agent.tmux); if (inspected.server === "unavailable" || inspected.server === "match" && inspected.paneState === "unavailable") throw new Error("Requester tmux evidence is temporarily unavailable"); return inspected.server === "match" && inspected.sessionAlive && inspected.paneState === "alive"; }); await reconcileMeshReservations(runtime.stateRoot, mesh.meshId, agentId => inspectMeshAgentWindow(exec, runtime.tmux, tmux, mesh.meshId, agentId), protectedReservations); await recoverPendingAgentStops({ stateRoot: runtime.stateRoot, meshId: mesh.meshId, exec, tmux: runtime.tmux });
        }
        if (sessionFile && current && endpoint) { const persistedReceipts = await readPersistedCompletionReceiptEvidence(sessionFile); await reconcileCompletionReceipts(runtime.stateRoot, current.meshId, { endpointId: current.endpointId, endpointSessionFile: sessionFile, claimantSessionFile: sessionFile, persistedReceipts }); confirmedReceiptIds.clear(); for (const receiptId of persistedReceipts.keys()) confirmedReceiptIds.add(receiptId); }
        const schedule = options.setInterval ? (callback: () => void | Promise<void>, delay: number) => options.setInterval!(() => { scheduledNow += delay; return callback(); }, delay) : (callback: () => void | Promise<void>, delay: number) => globalThis.setTimeout(() => { void callback(); }, delay);
        const cancel = options.clearInterval ?? (timer => globalThis.clearTimeout(timer as NodeJS.Timeout));
        cadence = new OrchestrationDeadlineScheduler({ now: deliveryNow, setTimeout: schedule, clearTimeout: cancel });
        if (rootLeaseId && current) {
            const rootOptions = () => ({ stateRoot: runtime.stateRoot, meshId: current!.meshId, leaseId: rootLeaseId!, gc: meshGcConfig(runtime.gc, catalog), exec, tmux: runtime.tmux, signal: maintenance.signal });
            cadence.add("materialize", 1000, async () => { await materializeWithDiagnostics(); });
            cadence.add("root-heartbeat", 2000, async () => { await heartbeatRootLease(runtime.stateRoot, current!.meshId, rootLeaseId!).catch(() => {}); });
            cadence.add("pressure", 3000, async () => { try { await processPressureAdmissions(rootOptions()); } catch (error) { if (!maintenance.signal.aborted) sessionContext?.ui.setStatus("mesh-agent-gc", `Mesh agent GC: ${errorText(error)}`); } });
            cadence.add("gc", runtime.gc.periodicIntervalMs, async () => { try { const maintenanceOptions = rootOptions(); await recoverPendingAgentStops(maintenanceOptions); await runPeriodicAgentGc(maintenanceOptions); } catch (error) { if (!maintenance.signal.aborted) sessionContext?.ui.setStatus("mesh-agent-gc", `Mesh agent GC: ${errorText(error)}`); } });
        }
        cadence.add("delivery", 2000, async () => { if (!await materializeWithDiagnostics()) return; await pumpWithDiagnostics(); });
        cadence.add("completion-delivery", COMPLETION_DELIVERY_WINDOW_MS, pumpWithDiagnostics, { enabled: false });
        cadence.add("wait-input", 250, async () => {
            if (armedWait.currentState !== "armed-waiting") { cadence?.setEnabled("wait-input", false); return; }
            try {
                if (!await waitBindingIsLive()) { failWait(new Error("endpoint binding or active child task is no longer current")); return; }
                if (sessionContext?.hasPendingMessages()) armedWait.notifyQueued("user");
                if (sessionContext) await setWaitStatus(sessionContext);
            } catch (error) { failWait(error); }
        }, { enabled: false });
        cadence.add("notices", 3000, pumpTuiNotices);
        const reportWakeError = (label: string, error: unknown) => { const diagnostic = `Mesh event pump: ${label} wake: ${errorText(error)}`; try { sessionContext?.ui.setStatus(PUMP_STATUS, diagnostic); } catch {} try { sessionContext?.ui.notify(diagnostic, "error"); } catch {} };
        if (current && endpoint) {
            const watchedEndpoint = endpoint; const watchedMeshId = current.meshId;
            wakeHints.push(await createDirectoryWake({ directory: endpointBindingInboxDirectory(runtime.stateRoot, watchedMeshId, { endpointId: watchedEndpoint.endpointId, endpointSessionFile: watchedEndpoint.sessionFile, bindingId: watchedEndpoint.bindingId }), recursive: true, run: async () => { if (endpoint !== watchedEndpoint || current?.meshId !== watchedMeshId || shuttingDown) return; if (!rootLeaseId || await materializeWithDiagnostics()) await pumpWithDiagnostics(); }, onError: error => reportWakeError("endpoint", error), dependencies: options.wake }));
            if (rootLeaseId) wakeHints.push(await createDirectoryWake({ directory: rootCompletionQueueDirectory(runtime.stateRoot, watchedMeshId), recursive: true, run: async () => { if (endpoint !== watchedEndpoint || current?.meshId !== watchedMeshId || shuttingDown) return; if (await materializeWithDiagnostics()) await pumpWithDiagnostics(); }, onError: error => reportWakeError("completion queue", error), dependencies: options.wake }));
        }
        if (!rootLeaseId || !current || await materializeWithDiagnostics()) await pumpWithDiagnostics();
        await pumpTuiNotices();
        cadence.start();
    });
    if (!isolatedPromptOnly) pi.on("context", async event => {
        // These messages already left Pi's queue even if projection or durable acknowledgment fails.
        // Retire only IDs present in this context; other queued follow-ups must remain observable.
        for (const message of event.messages) {
            const raw = asRecord(message); if (raw.customType !== "mesh-event") continue;
            const details = asRecord(raw.details);
            const ids = [details.eventId, ...(Array.isArray(details.eventIds) ? details.eventIds : []), ...(Array.isArray(details.sources) ? details.sources.map(source => asRecord(source).eventId) : [])];
            for (const eventId of ids) if (typeof eventId === "string") awaitingContextEvents.delete(eventId);
        }
        try {
            if (!current?.sessionFile) return;
            const claimedThisContext: string[] = [];
            const receiptIdsCreated: string[] = [];
            const completionMessages = event.messages.flatMap((message, index) => {
                const raw = message as unknown as Record<string, unknown>;
                const details = raw.details && typeof raw.details === "object" && !Array.isArray(raw.details) ? raw.details as Record<string, unknown> : undefined;
                return raw.customType === "mesh-event" && details?.kind === "completion" ? [{ index, details }] : [];
            });
            const retained = completionMessages.at(-1);
            try {
                const retainedDetails = retained?.details;
                const deliveryId = typeof retainedDetails?.deliveryId === "string" ? retainedDetails.deliveryId : undefined;
                const wakeId = typeof retainedDetails?.wakeId === "string" ? retainedDetails.wakeId : undefined;
                const resultTaskIds = Array.isArray(retainedDetails?.resultTaskIds) ? retainedDetails.resultTaskIds.filter((taskId): taskId is string => typeof taskId === "string") : [];
                if (retainedDetails && deliveryId && wakeId && resultTaskIds.length) {
                    const mesh = await readMesh(runtime.stateRoot, current.meshId);
                    // A completion delivery from a predecessor mesh is stale once this session's mesh was replaced: its tasks are not routable here and the delivery must not break later turns.
                    const retainedTasks = await Promise.all(resultTaskIds.map(taskId => readTask(runtime.stateRoot, mesh.meshId, taskId).catch(() => undefined)));
                    if (retainedTasks.some(task => task === undefined)) {
                        retainedDetails.accounting = { staleDelivery: true };
                    } else {
                    const createdBefore = receiptIdsCreated.length; const claimedBefore = claimedThisContext.length;
                    try {
                    const eventIds = Array.isArray(retainedDetails.sources) ? retainedDetails.sources.map(source => asRecord(source).eventId).filter((eventId): eventId is string => typeof eventId === "string") : [];
                    const receipt = await createNotificationCompletionReceipt(runtime.stateRoot, current.meshId, { endpointId: current.endpointId, endpointSessionFile: current.sessionFile, claimantSessionFile: current.sessionFile, deliveryId, wakeId, eventIds, taskIds: resultTaskIds, maxTasksPerMesh: mesh.budgets.maxTasksPerMesh });
                    if (receipt.receipt) {
                        confirmedReceiptIds.add(receipt.receipt.receiptId);
                        if (receipt.created) receiptIdsCreated.push(receipt.receipt.receiptId);
                        retainedDetails.accounting = { claimedTaskIds: [], receiptIds: [receipt.receipt.receiptId], receivedTaskIds: receipt.receivedTaskIds.length ? receipt.receivedTaskIds : receipt.receipt.taskIds };
                    }
                    const claimedTaskIds: string[] = [];
                    for (const taskId of receipt.receivedTaskIds) {
                        const snapshotForTask = await readAgentSnapshot(runtime.stateRoot, current.meshId, (await readTask(runtime.stateRoot, current.meshId, taskId)).request.agentId, taskId);
                        if (!snapshotForTask.agent.capabilities.usage) continue;
                        const claimed = await claimTaskUsage(runtime.stateRoot, current.meshId, taskId, current.sessionFile, { source: "notification", deliveryId, wakeId });
                        if (claimed.created) { claimedTaskIds.push(taskId); claimedThisContext.push(taskId); }
                    }
                    if (retainedDetails.accounting && typeof retainedDetails.accounting === "object") (retainedDetails.accounting as { claimedTaskIds: string[] }).claimedTaskIds = claimedTaskIds;
                    } catch (error) {
                        // A delivery routed to a superseded binding of this same session is stale once the endpoint reattached; it must not break later turns.
                        if (receiptIdsCreated.length === createdBefore && claimedThisContext.length === claimedBefore && /is not routed to the caller endpoint session/u.test(String(error))) {
                            retainedDetails.accounting = { staleDelivery: true };
                        } else {
                            throw error;
                        }
                    }
                    }
                }
            } catch (error) {
                for (const receiptId of receiptIdsCreated) await rollbackCompletionReceipt(runtime.stateRoot, current.meshId, { endpointId: current.endpointId, endpointSessionFile: current.sessionFile, receiptId }).catch(() => {});
                for (const taskId of claimedThisContext) await rollbackTaskUsageClaim(runtime.stateRoot, current.meshId, taskId, current.sessionFile).catch(() => {});
                throw error;
            }
            const receiptIds = new Set(receiptIdsFromToolResults(event.messages)); for (const receiptId of receiptIds) confirmedReceiptIds.add(receiptId);
            const ledger = await readCompletionLedger(runtime.stateRoot, current.meshId, current.endpointId, current.sessionFile);
            const receivedTaskIds = new Set((ledger?.receipts ?? []).filter(receipt => confirmedReceiptIds.has(receipt.receiptId)).flatMap(receipt => receipt.taskIds));
            const projection = projectMeshCompletionContext(event.messages, receivedTaskIds);
            const retainedResultIds = new Set(Array.isArray(retained?.details.resultTaskIds) ? retained.details.resultTaskIds.filter((taskId): taskId is string => typeof taskId === "string") : []);
            const deliveryAckIds = Array.isArray(retained?.details.sources)
                ? retained.details.sources.flatMap(source => {
                    const raw = asRecord(source);
                    const eventId = typeof raw.eventId === "string" ? raw.eventId : undefined;
                    const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(task => asRecord(task).taskId).filter((taskId): taskId is string => typeof taskId === "string") : [];
                    return eventId && tasks.length && tasks.every(taskId => retainedResultIds.has(taskId)) ? [eventId] : [];
                })
                : [];
            const hasRetainedDelivery = typeof retained?.details.deliveryId === "string";
            for (const item of completionMessages) {
                const sources = Array.isArray(item.details.sources) ? item.details.sources : [];
                for (const source of sources) {
                    const eventId = asRecord(source).eventId;
                    if (typeof eventId !== "string") continue;
                    if (hasRetainedDelivery ? !deliveryAckIds.includes(eventId) : !projection.eventIds.includes(eventId)) injectedThisRuntime.delete(eventId);
                }
                if (item !== retained && Array.isArray(item.details.resultTaskIds)) {
                    for (const taskId of item.details.resultTaskIds) if (typeof taskId === "string") deliveredCompletionTaskIds.delete(taskId);
                }
            }
            const normalEventIds: string[] = []; const interventionIds: string[] = [];
            for (const message of projection.messages) {
                const raw = message as unknown as Record<string, unknown>; const details = raw.details && typeof raw.details === "object" && !Array.isArray(raw.details) ? raw.details as Record<string, unknown> : undefined;
                if (raw.customType !== "mesh-event" || !details) continue;
                if (details.kind === "completion" && Array.isArray(details.sources)) for (const source of details.sources as Array<{ tasks: FrozenTask[] }>) for (const task of source.tasks) trackedWaitTasks.delete(task.taskId);
                if (details.kind === "intervention" && typeof details.eventId === "string") interventionIds.push(details.eventId);
                else if (details.kind === "report" && typeof details.eventId === "string") normalEventIds.push(details.eventId);
                else if (details.kind === "delivery-ack" && Array.isArray(details.eventIds)) for (const eventId of details.eventIds) if (typeof eventId === "string") normalEventIds.push(eventId);
            }
            if (endpoint) {
                const acknowledged = [...new Set([...(hasRetainedDelivery ? deliveryAckIds : projection.eventIds), ...normalEventIds])];
                if (acknowledged.length) await acknowledgeMeshEvents(runtime.stateRoot, current.meshId, endpoint, acknowledged);
                if (interventionIds.length && endpoint.kind === "agent") await acknowledgeMeshContextInterventions(runtime.stateRoot, current.meshId, endpoint, interventionIds);
            }
            return { messages: projection.messages };
        } catch (error) { failWait(error); throw error; }
    });
    let removeRunAbortListener = () => {};
    if (!isolatedPromptOnly) {
        pi.on("turn_start", () => { batchTools.clear(); });
        pi.on("tool_call", async (event, ctx) => {
            batchTools.set(event.toolCallId, event.toolName);
            if (event.toolName === END_RESPONSE_TOOL_NAME) return;
            const admission = await executionGate.waitForAdmission(event.toolCallId, ctx.signal);
            if (admission === "abort") return { block: true, reason: "Mesh execution interrupted" };
        });
        pi.on("tool_execution_end", event => { executionGate.complete(event.toolCallId); });
        pi.on("before_provider_request", async (_event, ctx) => {
            const admission = await executionGate.waitForAdmission("provider", ctx.signal);
            if (admission === "abort") throw ctx.signal?.reason ?? new Error("Mesh execution interrupted");
        });
        pi.on("after_provider_response", () => { executionGate.complete("provider"); });
        pi.on("agent_start", (_event, ctx) => { batchTools.clear(); removeRunAbortListener(); const signal = ctx.signal; const abort = () => { if (armedWait.isArmed()) noteAbort(); }; signal?.addEventListener("abort", abort, { once: true }); removeRunAbortListener = () => signal?.removeEventListener("abort", abort); });
        pi.on("input", async event => {
            if (event.source === "interactive") {
                if (armedWait.currentState === "armed-waiting") armedWait.recordWakeOrigin("user");
                if (current?.agentId) {
                    const result = await applyAgentControl(runtime.stateRoot, current.meshId, current.agentId, { action: "resume", source: "user", issuer: current.endpointId }).catch(() => undefined);
                    if (result && shouldOpenExecutionGate(result)) executionGate.resume(result.state.revision);
                } else if (current) {
                    executionGate.resume(executionGate.currentRevision + 1);
                }
            }
            if (armedWait.currentState === "armed-waiting") cadence?.setEnabled("wait-input", true);
            return { action: "continue" as const };
        });
        pi.on("agent_end", async (event, ctx) => {
            if (ctx.signal?.aborted) { noteAbort(); return; }
            if (!isJoinableAgentEnd(event.messages) || hasQueuedWaitMessages(ctx) || !current || !endpoint) return;
            try {
                const activeTaskId = current.agentId ? (await readAgentSnapshot(runtime.stateRoot, current.meshId, current.agentId)).status.activeTaskId : undefined;
                if (armedEndpoint && (waitBindingKey(current, armedEndpoint) !== waitBindingKey(current, endpoint) || armedTaskId !== activeTaskId)) clearWaitSession();
                armedEndpoint = endpoint;
                armedTaskId = activeTaskId;
                armedWait.arm(waitBindingKey(current, endpoint));
                await setWaitStatus(ctx);
                const waiting = armedWait.wait(waitBindingKey(current, endpoint), ctx.signal, () => inspectArmedWait(ctx));
                cadence?.setEnabled("wait-input", true);
                const outcome = await waiting;
                if (outcome === "aborted") noteAbort();
                if (outcome !== "resumed") clearWaitSession();
                if (outcome === "invalid") ctx.ui.notify("Mesh wait ended because its endpoint binding is no longer current", "error");
            } catch (error) {
                clearWaitSession();
                const diagnostic = `Mesh wait ended: ${errorText(error)}`;
                try { ctx.ui.notify(diagnostic, "error"); } catch {}
                try { ctx.ui.setStatus(PUMP_STATUS, diagnostic); } catch {}
            } finally { cadence?.setEnabled("wait-input", false); try { ctx.ui.setStatus(WAIT_STATUS, undefined); } catch {} }
        });
        pi.on("agent_settled", async () => { removeRunAbortListener(); batchTools.clear(); clearWaitSession(); awaitingContextEvents.clear(); await recoverInjectedEvents(); });
    }
    if (resolvedEnvelope) pi.on("before_agent_start", event => { const instructions = resolvedEnvelope!.self.instructions; return { systemPrompt: `${event.systemPrompt}\n\n${instructions}` }; });
    const paletteDeps = (): MeshPaletteDependencies => {
        const caller = active(deps);
        return {
            meshId: caller.meshId, exec, tmux: runtime.tmux, piCommand: runtime.harnesses.pi!.command, natureHandleWords: runtime.natureHandleWords, tmuxPreviewActions: loadFeatureKeybindings("tmuxPreview").actions,
            discover: async identity => { const store = await import("./utilities/orchestration_store.ts"); const allItems = await store.listMeshAgents(runtime.stateRoot, identity.meshId); const items = caller.agentId ? allItems.filter(item => item.agent.parentAgentId === caller.agentId) : allItems; const values = await Promise.all(items.map(item => readReconciledAgentSnapshot(exec, runtime.tmux, runtime.stateRoot, identity.meshId, item.agent.agentId).then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })))); return { agents: values.flatMap(item => item.ok ? [item.value] : []), malformedCount: values.filter(item => !item.ok).length }; },
            stopAgent: request => stopPaletteMeshAgent(deps, runtime, request),
            controlAgent: async request => {
                const caller = await authorized(deps);
                rejectSelfAgent(caller, request.agentId, "control");
                const stored = await readAgentSnapshot(runtime.stateRoot, request.meshId, request.agentId);
                authorizeAgent(caller, stored, "control");
                return applySubtreeControl(caller, request.agentId, request.action, "user");
            },
        };
    };
    let unregister = () => {};
    if (!isolatedPromptOnly) { providePopupView(pi, { id: "agent-sessions", title: "Mesh Agents", create(view) { try { const component = new MeshAgentsPaletteComponent({ tui: view.tui, theme: view.theme, ui: view.extensionContext.ui, keymap: loadPaletteKeymap(undefined, "meshPalette").keymap, deps: paletteDeps(), done: disposition => view.done(disposition === "close" ? "close-all" : "back") }); component.start(); return component; } catch (error) { try { view.extensionContext.ui.notify(error instanceof Error ? error.message : String(error), "error"); } catch {} try { view.done("close-all"); } catch {} return { invalidate() {}, render() { return []; } }; } } }); const open = async (ctx: ExtensionContext, placement: "root" | "push" = "root") => { try { active(deps); } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); return "return" as const; } return openPopupView(pi, "agent-sessions", ctx, placement); }; unregister = provideCommandPaletteContribution(pi.events, { owner: "mesh", id: "agents", label: "/mesh  Manage mesh agents", description: "Open, unlink, inspect, or stop mesh agent sessions.", keywords: ["mesh", "agents", "tmux"], run: async ctx => (await open(ctx, "push")) === "close-all" ? "close" : "return" }); pi.registerCommand("mesh", { description: "Manage persistent mesh agents", handler: async (args, ctx) => {
        const tokens = args.trim().split(/\s+/u).filter(Boolean);
        const action = tokens[0];
        if (action === "pause" || action === "interrupt" || action === "resume") {
            const caller = await authorized(deps);
            const targetId = tokens[1];
            if (targetId) {
                rejectSelfAgent(caller, targetId, "control");
                const stored = await readAgentSnapshot(runtime.stateRoot, caller.meshId, targetId);
                authorizeAgent(caller, stored, "control");
                const result = await applySubtreeControl(caller, targetId, action, "user");
                ctx.ui.notify(`${action} ${result.targets.map(target => `${target.status}:${target.phase}`).join(", ")}`, result.targets.some(target => target.status === "unsupported" || target.status === "not_ready") ? "warning" : "info");
                return;
            }
            if (caller.agentId) {
                const result = await applySubtreeControl(caller, caller.agentId, action, "user");
                if (action === "pause") executionGate.requestPause(executionGate.currentRevision + 1 || 1);
                if (action === "interrupt") executionGate.requestInterrupt(executionGate.currentRevision + 1 || 1);
                if (action === "resume") executionGate.resume(executionGate.currentRevision + 1 || 1);
                ctx.ui.notify(`${action} ${result.targets.length} targets`, "info");
                return;
            }
            const agents = await listMeshAgents(runtime.stateRoot, caller.meshId);
            const roots = agents.filter(item => !item.agent.parentAgentId && !isTerminalAgent(item.status.state));
            for (const rootAgent of roots) await applySubtreeControl(caller, rootAgent.agent.agentId, action, "user");
            if (action === "pause") executionGate.requestPause(executionGate.currentRevision + 1 || 1);
            if (action === "interrupt") executionGate.requestInterrupt(executionGate.currentRevision + 1 || 1);
            if (action === "resume") executionGate.resume(executionGate.currentRevision + 1 || 1);
            ctx.ui.notify(`${action} current session and descendants`, "info");
            return;
        }
        await open(ctx);
    } }); }
    pi.on("session_shutdown", async event => { shuttingDown = true; removeRunAbortListener(); clearWaitSession(); awaitingContextEvents.clear(); deliveryGeneration += 1; cadence?.setEnabled("wait-input", false); const closingWakeHints = wakeHints; wakeHints = []; await Promise.all(closingWakeHints.map(wake => wake.close())); maintenance.abort(new Error("Mesh root maintenance stopped for session shutdown")); unregister(); await cadence?.stop(); if (endpoint && current) await setMeshEndpointOffline(runtime.stateRoot, current.meshId, endpoint.endpointId, endpoint).catch(() => {}); if (!childAgentId && current && rootLeaseId) await failOpenPressureAdmissions(runtime.stateRoot, current.meshId).catch(() => {}); if (childAgentId || !current || !rootLeaseId || event.reason === "reload") return; await beginMeshClose(runtime.stateRoot, current.meshId, rootLeaseId); const hubContext = await probeTmux(exec, runtime.tmux, env) ?? undefined; await cleanupMeshAgents({ stateRoot: runtime.stateRoot, meshId: current.meshId, exec, tmux: runtime.tmux, shutdownReason: event.reason, hubContext }); await completeMeshClose(runtime.stateRoot, current.meshId, rootLeaseId); try { const transitionFence = await readParentTransition(runtime.stateRoot, current.meshId); if (transitionFence && transitionFence.kind === "handoff" && transitionFence.rootLeaseId === rootLeaseId) await releaseParentTransition(runtime.stateRoot, current.meshId, { token: transitionFence.token, rootLeaseId: transitionFence.rootLeaseId }); } catch {} });
    return true;
}
export default registerOrchestration;
