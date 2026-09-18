/** Process-local execution control: joinable ends, wake origin, holds, and admission gates. Persistence stays in the store; Pi/ACP connections stay in their owners. */

export const END_RESPONSE_TOOL_NAME = "end_response" as const;
export const MESH_CONTROL_TOOL_NAME = "mesh_control" as const;
export const END_RESPONSE_ERROR_STANDALONE = "standalone_call_required" as const;
export const CONTROL_SCHEMA_VERSION = 1 as const;
export const PROGRESS_SCHEMA_VERSION = 1 as const;
export const EXECUTION_RESUME_CUSTOM_TYPE = "mesh-execution-resume" as const;
export const EXECUTION_RESUME_CONTENT = "Continue the held task in this conversation. Confirmed tool results remain. Interrupted or unconfirmed side effects are incomplete; do not replay them. Inspect current state before the next action.";

export type WakeOrigin = "user" | "mesh-event";
export type ExecutionPhase = "running" | "waiting" | "pausing" | "paused" | "interrupting" | "interrupted" | "blocked-limit" | "unavailable";
export type HoldKind = "manual" | "limit";
export type ControlAction = "pause" | "interrupt" | "resume";
export type ControlSource = "user" | "peer" | "system";
export type ControlTargetStatus = "requested" | "acknowledged" | "unsupported" | "unavailable" | "already-terminal" | "not_ready" | "manual_resume_required";

export interface EndResponseMarker {
    kind: typeof END_RESPONSE_TOOL_NAME;
    toolCallId: string;
    ended: true;
}

export interface WakeRecord {
    wakeId: string;
    origin: WakeOrigin;
    bindingId: string;
    eventIds: readonly string[];
    createdAt: string;
}

export interface ExecutionHold {
    holdId: string;
    kind: HoldKind;
    revision: number;
    requestId: string;
    source: ControlSource;
    targetRoot: string;
    targetRuntimeId?: string;
    targetBindingId?: string;
    createdAt: string;
}

export interface ExecutionControlRequest {
    schemaVersion: typeof CONTROL_SCHEMA_VERSION;
    meshId: string;
    requestId: string;
    revision: number;
    action: ControlAction;
    source: ControlSource;
    issuer: string;
    targetRoot: string;
    targetIds: readonly string[];
    createdAt: string;
}

export function meshYieldNextAction() {
    return { action: "continue_independent_work" as const, yieldVia: END_RESPONSE_TOOL_NAME, arguments: {} as const, calls: "once" as const, keepCallerOpen: true as const };
}

export function asMessageRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function finalStopReason(messages: readonly unknown[]): string | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = asMessageRecord(messages[index]);
        if (message.role === "assistant") return typeof message.stopReason === "string" ? message.stopReason : undefined;
    }
    return undefined;
}

export function assistantToolCalls(messages: readonly unknown[]): Array<{ id: string; name: string }> {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = asMessageRecord(messages[index]);
        if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
        return message.content.flatMap(part => {
            const item = asMessageRecord(part);
            if (item.type !== "toolCall" || typeof item.id !== "string" || typeof item.name !== "string") return [];
            return [{ id: item.id, name: item.name }];
        });
    }
    return [];
}

export function endResponseBatchKind(messages: readonly unknown[], toolCallId: string): "standalone" | "mixed" | "missing" {
    const calls = assistantToolCalls(messages);
    if (!calls.some(call => call.id === toolCallId && call.name === END_RESPONSE_TOOL_NAME)) return "missing";
    return calls.length === 1 && calls[0]?.name === END_RESPONSE_TOOL_NAME ? "standalone" : "mixed";
}

export function successfulEndResponseMarker(messages: readonly unknown[]): EndResponseMarker | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = asMessageRecord(messages[index]);
        if (message.role !== "toolResult" || message.toolName !== END_RESPONSE_TOOL_NAME || message.isError === true) continue;
        const details = asMessageRecord(message.details);
        if (details.kind !== END_RESPONSE_TOOL_NAME || details.ended !== true || typeof details.toolCallId !== "string") continue;
        if (endResponseBatchKind(messages, details.toolCallId) !== "standalone") return undefined;
        return { kind: END_RESPONSE_TOOL_NAME, toolCallId: details.toolCallId, ended: true };
    }
    return undefined;
}

/** Joinable ends are a normal stop or a successful standalone end_response. Arbitrary toolUse, error, length, and abort are not rewritten. */
export function isJoinableAgentEnd(messages: readonly unknown[]): boolean {
    const stopReason = finalStopReason(messages);
    if (stopReason === "stop") return true;
    return successfulEndResponseMarker(messages) !== undefined;
}

export function canApplyControlRevision(currentRevision: number, requestRevision: number): boolean {
    return Number.isInteger(currentRevision) && Number.isInteger(requestRevision) && requestRevision >= currentRevision;
}

/** Interactive input may reopen the local gate only after the store released a manual hold. */
export function shouldOpenExecutionGate(result: {
    applied: boolean;
    status: string;
    state: { holds: readonly ExecutionHold[]; interrupting: boolean; interruptConfirmed: boolean };
}): boolean {
    if (!result.applied) return false;
    if (result.status === "not_ready" || result.status === "unavailable" || result.status === "manual_resume_required" || result.status === "already-terminal") return false;
    if (result.state.holds.some(hold => hold.kind === "limit")) return false;
    if (result.state.interrupting && !result.state.interruptConfirmed) return false;
    return true;
}

export function projectExecutionPhase(input: {
    waiting: boolean;
    inFlightCount: number;
    holds: readonly ExecutionHold[];
    interrupting: boolean;
    interruptConfirmed: boolean;
    unavailable: boolean;
}): ExecutionPhase {
    if (input.unavailable) return "unavailable";
    if (input.holds.some(hold => hold.kind === "limit")) return "blocked-limit";
    if (input.interrupting && !input.interruptConfirmed) return "interrupting";
    if (input.holds.some(hold => hold.kind === "manual") && input.interruptConfirmed) return "interrupted";
    if (input.holds.some(hold => hold.kind === "manual") && input.inFlightCount > 0) return "pausing";
    if (input.holds.some(hold => hold.kind === "manual")) return "paused";
    if (input.waiting) return "waiting";
    return "running";
}

/** Process-local admission gate. Disk restore never reconstitutes it. */
export class ProcessExecutionGate {
    private revision = 0;
    private paused = false;
    private interrupting = false;
    private readonly admitted = new Set<string>();
    private readonly inFlight = new Set<string>();
    private readonly waiters: Array<() => void> = [];

    get currentRevision(): number { return this.revision; }
    get inFlightCount(): number { return this.inFlight.size; }
    get isPaused(): boolean { return this.paused; }
    get isInterrupting(): boolean { return this.interrupting; }

    requestPause(revision: number): boolean {
        if (!canApplyControlRevision(this.revision, revision)) return false;
        this.revision = revision;
        this.paused = true;
        return true;
    }

    requestInterrupt(revision: number): boolean {
        if (!canApplyControlRevision(this.revision, revision)) return false;
        this.revision = revision;
        this.paused = true;
        this.interrupting = true;
        this.releaseWaiters();
        return true;
    }

    resume(revision: number): boolean {
        if (!canApplyControlRevision(this.revision, revision)) return false;
        this.revision = revision;
        this.paused = false;
        this.interrupting = false;
        this.admitted.clear();
        this.releaseWaiters();
        return true;
    }

    async waitForAdmission(id: string, signal?: AbortSignal): Promise<"admit" | "abort"> {
        if (signal?.aborted) return "abort";
        if (!this.paused || this.admitted.has(id)) {
            this.admitted.add(id);
            this.inFlight.add(id);
            return "admit";
        }
        if (this.interrupting) return "abort";
        return await new Promise<"admit" | "abort">(resolve => {
            const abort = () => { cleanup(); resolve("abort"); };
            const wake = () => {
                cleanup();
                if (signal?.aborted || this.interrupting) { resolve("abort"); return; }
                if (!this.paused || this.admitted.has(id)) {
                    this.admitted.add(id);
                    this.inFlight.add(id);
                    resolve("admit");
                    return;
                }
                void this.waitForAdmission(id, signal).then(resolve);
            };
            const cleanup = () => {
                signal?.removeEventListener("abort", abort);
                const index = this.waiters.indexOf(wake);
                if (index >= 0) this.waiters.splice(index, 1);
            };
            signal?.addEventListener("abort", abort, { once: true });
            this.waiters.push(wake);
        });
    }

    complete(id: string): void {
        this.inFlight.delete(id);
        this.admitted.delete(id);
    }

    private releaseWaiters(): void {
        const pending = this.waiters.splice(0);
        for (const wake of pending) wake();
    }
}
