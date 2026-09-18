import { AcpTransport, isAcpJsonRpcError, type JsonRpcMessage } from "./orchestration_acp.ts";
import { UnconfirmedTerminationError, isUnconfirmedTermination, type ExternalDriver, type ExternalTaskResult, type ExternalWorkerEvent } from "./orchestration_external_driver.ts";

type JsonObject = Record<string, unknown>;
function record(value: unknown): JsonObject | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined; }
function scalar(value: unknown): string { return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : ""; }
function textFrom(value: unknown): string { if (typeof value === "string") return value; if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join(""); const item = record(value); if (!item) return ""; for (const key of ["text", "content", "message", "title", "name", "detail"]) { const text = textFrom(item[key]); if (text) return text; } return ""; }
function supportsMode(session: JsonObject, mode: string): boolean { const modes = record(session.modes)?.availableModes; return Array.isArray(modes) && modes.some(candidate => candidate === mode || record(candidate)?.id === mode); }
function matchesModelCandidate(candidate: unknown, model: string): boolean { const value = record(candidate); return candidate === model || [value?.modelId, value?.value, value?.id, value?.name].includes(model); }
function supportsModel(session: JsonObject, model: string): boolean {
    const configOptions = session.configOptions;
    const modelConfig = Array.isArray(configOptions) ? configOptions.map(record).find(option => option?.id === "model") : undefined;
    const modelsConfig = record(session.models);
    const currentValues = [modelConfig?.currentValue, modelConfig?.value, modelsConfig?.currentModelId, record(modelsConfig?.currentModel)?.modelId, record(modelsConfig?.currentModel)?.id].filter((value): value is string => typeof value === "string" && value.length > 0);
    if (currentValues.length) return currentValues.every(value => value === model);
    const advertised = modelConfig && Array.isArray(modelConfig.options) && modelConfig.options.some(candidate => matchesModelCandidate(candidate, model));
    const models = modelsConfig?.availableModels;
    const advertisedModel = Array.isArray(models) && models.some(candidate => matchesModelCandidate(candidate, model));
    return Boolean(advertised || advertisedModel);
}
function sessionIdFrom(message: JsonRpcMessage): string | undefined {
    const params = record(message.params);
    const nested = record(params?.update);
    const candidates = [params?.sessionId, nested?.sessionId];
    for (const candidate of candidates) if (typeof candidate === "string" && candidate.trim()) return candidate;
    return undefined;
}

export interface CursorAcpDriverOptions {
    command: string;
    cwd: string;
    model: string;
    expectedAcpModelId: string;
    mode: "ask" | "agent";
    permissionPolicy: "reject" | "allow-always";
    event: (event: ExternalWorkerEvent) => void;
}

export class CursorAcpDriver implements ExternalDriver {
    readonly #options: CursorAcpDriverOptions;
    #transport?: AcpTransport;
    #sessionId?: string;
    #output = "";
    #turnFailure?: Error;
    #rejectTurnFailure?: (error: Error) => void;
    #turnActive = false;
    #turnCancelled = false;
    #reuseBlocked?: UnconfirmedTerminationError;

    constructor(options: CursorAcpDriverOptions) { this.#options = options; }

    #failUnconfirmed(message: string): never {
        const error = new UnconfirmedTerminationError(message);
        this.#turnFailure ??= error;
        this.#reuseBlocked ??= error;
        this.#rejectTurnFailure?.(error);
        throw error;
    }

    #blockReuse(message: string): UnconfirmedTerminationError {
        const error = this.#reuseBlocked ?? new UnconfirmedTerminationError(message);
        this.#reuseBlocked ??= error;
        this.#options.event({ type: "state", text: message });
        return error;
    }

    #closeTurn(): void {
        if (!isUnconfirmedTermination(this.#turnFailure)) this.#turnActive = false;
    }

    #assertSession(message: JsonRpcMessage): boolean {
        const incoming = sessionIdFrom(message);
        if (!this.#sessionId) {
            this.#blockReuse(`ACP ${message.method} sessionId is missing`);
            return false;
        }
        if (!incoming) {
            this.#blockReuse(`ACP ${message.method} sessionId is missing`);
            return false;
        }
        if (incoming !== this.#sessionId) {
            this.#blockReuse(`ACP ${message.method} sessionId does not match the active session`);
            return false;
        }
        return true;
    }

    async #message(message: JsonRpcMessage): Promise<unknown> {
        if (message.method === "session/update") {
            if (!this.#assertSession(message)) return null;
            const update = record(record(message.params)?.update) ?? record(message.params) ?? {};
            const kind = scalar(update.sessionUpdate) || scalar(update.type) || scalar(update.kind) || "update";
            // Cursor acknowledges session/set_mode with this session-scoped state notification before any turn starts.
            if (!this.#turnActive && kind === "current_mode_update") {
                this.#options.event({ type: "state", text: `mode ${scalar(update.currentModeId) || "updated"}` });
                return null;
            }
            if (!this.#turnActive) {
                this.#blockReuse("ACP session/update arrived with no active turn");
                return null;
            }
            const text = textFrom(update);
            if (/agent_message|message_chunk|agentMessage/iu.test(kind) && text) { this.#output += text; this.#options.event({ type: "text", text }); }
            else if (/thought/iu.test(kind) && text) this.#options.event({ type: "thought", text });
            else if (/tool|plan|mode/iu.test(kind)) this.#options.event({ type: "tool", text: text || kind });
            return null;
        }
        if (message.method === "session/request_permission") {
            if (!this.#assertSession(message)) return { outcome: { outcome: "cancelled" } };
            if (!this.#turnActive) {
                this.#blockReuse("ACP permission request with no active turn");
                return { outcome: { outcome: "cancelled" } };
            }
            if (this.#turnCancelled || this.#reuseBlocked) return { outcome: { outcome: "cancelled" } };
            const options = Array.isArray(record(message.params)?.options) ? record(message.params)!.options as unknown[] : [];
            const normalized = options.map(record).filter((option): option is JsonObject => option !== undefined);
            const kind = (option: JsonObject) => scalar(option.kind).replaceAll("-", "_");
            const preferred = this.#options.permissionPolicy === "reject"
                ? normalized.find(option => kind(option) === "reject_once") ?? normalized.find(option => kind(option) === "reject_always")
                : normalized.find(option => kind(option) === "allow_always") ?? normalized.find(option => kind(option) === "allow_once");
            const optionId = preferred?.optionId;
            if (typeof optionId !== "string" || !optionId.trim()) this.#failUnconfirmed(this.#options.permissionPolicy === "reject" ? "Cursor permission request has no exact reject option" : "Cursor permission request has no exact allow-always or allow-once option");
            this.#options.event({ type: "permission", text: `${this.#options.permissionPolicy === "reject" ? "rejected" : "selected"} ${optionId}` });
            return { outcome: { outcome: "selected", optionId } };
        }
        if (message.method === "cursor/create_plan") { this.#options.event({ type: "tool", text: "accepted implementation plan" }); return { accepted: true }; }
        if (message.method === "cursor/ask_question") { this.#options.event({ type: "tool", text: "skipped blocking question; report blocker in result" }); return { skipped: true, reason: "non-interactive mesh agent" }; }
        if (message.method === "cursor/update_todos") {
            return {
                outcome: {
                    outcome: "rejected",
                    reason: "cursor/update_todos is not supported by this client",
                },
            };
        }
        if (message.id !== undefined) this.#failUnconfirmed(`Unsupported blocking ACP request: ${message.method}`);
        return null;
    }

    async start(): Promise<void> {
        const { command, cwd, model, expectedAcpModelId, mode, permissionPolicy } = this.#options;
        if (mode === "ask" ? permissionPolicy !== "reject" : mode !== "agent" || permissionPolicy !== "allow-always") throw new Error("Cursor ACP mode and permission policy combination is invalid");
        this.#options.event({ type: "state", text: `starting cursor-agent ${model}` });
        this.#transport = new AcpTransport(command, ["--model", model, "--force", "--sandbox", "disabled", "--trust", "acp"], { cwd, handler: message => this.#message(message) });
        const initialized = record(await this.#transport.request("initialize", { protocolVersion: 1, clientInfo: { name: "pi-mesh-worker", version: "1" }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }));
        if (initialized?.protocolVersion !== 1) throw new Error("Cursor ACP initialize returned an unsupported protocol version");
        const methods = Array.isArray(initialized.authMethods) ? initialized.authMethods : [];
        if (methods.length > 0) { const first = record(methods[0]); const methodId = first?.id ?? first?.methodId; if (typeof methodId !== "string") throw new Error("Cursor ACP authentication method is malformed"); await this.#transport.request("authenticate", { methodId }); }
        const session = record(await this.#transport.request("session/new", { cwd, mcpServers: [] }));
        if (!session) throw new Error("Cursor ACP session/new returned a malformed result");
        const sessionId = session.sessionId;
        if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("Cursor ACP session/new returned no sessionId");
        if (!supportsMode(session, mode)) throw new Error(`Cursor ACP does not advertise required mode ${mode}`);
        if (!supportsModel(session, expectedAcpModelId)) throw new Error(`Cursor ACP does not advertise required model ${model}`);
        this.#sessionId = sessionId;
        await this.#transport.request("session/set_mode", { sessionId, modeId: mode });
        this.#options.event({ type: "state", text: `session ${sessionId}` });
    }

    async runTask(prompt: string): Promise<ExternalTaskResult> {
        if (!this.#transport || !this.#sessionId) throw new Error("Cursor ACP driver is not started");
        if (this.#reuseBlocked) throw this.#reuseBlocked;
        this.#output = ""; this.#turnFailure = undefined; this.#turnActive = true; this.#turnCancelled = false;
        const blockingFailure = new Promise<never>((_resolve, reject) => { this.#rejectTurnFailure = reject; });
        try {
            let result: JsonObject | undefined;
            try {
                result = record(await Promise.race([this.#transport.request("session/prompt", { sessionId: this.#sessionId, prompt: [{ type: "text", text: prompt }] }, 24 * 60 * 60 * 1000, () => this.#closeTurn()), blockingFailure]));
            } catch (error) {
                if (isUnconfirmedTermination(this.#turnFailure)) throw this.#turnFailure;
                if (isAcpJsonRpcError(error)) throw error;
                this.#failUnconfirmed(error instanceof Error ? error.message : String(error));
            }
            if (this.#turnFailure) throw this.#turnFailure;
            const stopReason = result?.stopReason;
            if (typeof stopReason !== "string" || !stopReason.trim()) this.#failUnconfirmed("Cursor prompt completed without a stopReason");
            if (stopReason !== "end_turn") throw new Error(`Cursor task stopped with ${stopReason}${this.#transport.stderr() ? `: ${this.#transport.stderr()}` : ""}`);
            return { output: this.#output || textFrom(result), stopReason };
        } finally {
            this.#rejectTurnFailure = undefined;
            this.#closeTurn();
        }
    }

    async cancel(): Promise<void> { if (this.#turnActive) this.#turnCancelled = true; if (this.#transport && this.#sessionId) this.#transport.notify("session/cancel", { sessionId: this.#sessionId }); }
    partialOutput(): string { return this.#output; }
    async shutdown(): Promise<void> { await this.#transport?.shutdown(); }
    waitForClose(): Promise<Error> { return this.#transport?.waitForClose() ?? new Promise<Error>(() => {}); }
    fatalError(): Error | undefined {
        if (this.#reuseBlocked) return this.#reuseBlocked;
        const fatal = this.#transport?.fatalError();
        if (!fatal) return undefined;
        if (this.#transport?.exitObserved()) return fatal;
        return isUnconfirmedTermination(fatal) ? fatal : new UnconfirmedTerminationError(fatal.message);
    }
    exitObserved(): boolean { return this.#transport?.exitObserved() ?? false; }
}
