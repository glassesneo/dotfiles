import { AcpTransport, type JsonRpcMessage } from "./orchestration_acp.ts";
import type { ExternalDriver, ExternalTaskResult, ExternalWorkerEvent } from "./orchestration_external_driver.ts";

type JsonObject = Record<string, unknown>;
function record(value: unknown): JsonObject | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined; }
function scalar(value: unknown): string { return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : ""; }
function textFrom(value: unknown): string { if (typeof value === "string") return value; if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join(""); const item = record(value); if (!item) return ""; for (const key of ["text", "content", "message", "title", "name", "detail"]) { const text = textFrom(item[key]); if (text) return text; } return ""; }
function supportsMode(session: JsonObject, mode: string): boolean { const modes = record(session.modes)?.availableModes; return Array.isArray(modes) && modes.some(candidate => candidate === mode || record(candidate)?.id === mode); }
const cursorAcpModelIds: Readonly<Record<string, string>> = {
    "cursor-grok-4.5-high-fast": "grok-4.5[effort=high,fast=true]",
    "cursor-grok-4.6-high-fast": "grok-4.6[effort=high,fast=true]",
};
function expectedAcpModelId(model: string): string { const modelId = cursorAcpModelIds[model]; if (!modelId) throw new Error(`Cursor ACP model mapping is unavailable for ${model}`); return modelId; }
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

export interface CursorAcpDriverOptions {
    command: string;
    cwd: string;
    model: string;
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

    constructor(options: CursorAcpDriverOptions) { this.#options = options; }
    #failTurn(message: string): never { const error = new Error(message); this.#turnFailure ??= error; this.#rejectTurnFailure?.(error); throw error; }

    async #message(message: JsonRpcMessage): Promise<unknown> {
        if (message.method === "session/update") {
            const update = record(record(message.params)?.update) ?? record(message.params) ?? {};
            const kind = scalar(update.sessionUpdate) || scalar(update.type) || scalar(update.kind) || "update";
            const text = textFrom(update);
            if (/agent_message|message_chunk|agentMessage/iu.test(kind) && text) { this.#output += text; this.#options.event({ type: "text", text }); }
            else if (/thought/iu.test(kind) && text) this.#options.event({ type: "thought", text });
            else if (/tool|plan|mode/iu.test(kind)) this.#options.event({ type: "tool", text: text || kind });
            return null;
        }
        if (message.method === "session/request_permission") {
            if (this.#turnCancelled) return { outcome: { outcome: "cancelled" } };
            const options = Array.isArray(record(message.params)?.options) ? record(message.params)!.options as unknown[] : [];
            const normalized = options.map(record).filter((option): option is JsonObject => option !== undefined);
            const kind = (option: JsonObject) => scalar(option.kind).replaceAll("-", "_");
            const preferred = this.#options.permissionPolicy === "reject"
                ? normalized.find(option => kind(option) === "reject_once") ?? normalized.find(option => kind(option) === "reject_always")
                : normalized.find(option => kind(option) === "allow_always") ?? normalized.find(option => kind(option) === "allow_once");
            const optionId = preferred?.optionId;
            if (typeof optionId !== "string" || !optionId.trim()) this.#failTurn(this.#options.permissionPolicy === "reject" ? "Cursor permission request has no exact reject option" : "Cursor permission request has no exact allow-always or allow-once option");
            this.#options.event({ type: "permission", text: `${this.#options.permissionPolicy === "reject" ? "rejected" : "selected"} ${optionId}` });
            return { outcome: { outcome: "selected", optionId } };
        }
        if (message.method === "cursor/create_plan") { this.#options.event({ type: "tool", text: "accepted implementation plan" }); return { accepted: true }; }
        if (message.method === "cursor/ask_question") { this.#options.event({ type: "tool", text: "skipped blocking question; report blocker in result" }); return { skipped: true, reason: "non-interactive mesh agent" }; }
        if (message.id !== undefined) this.#failTurn(`Unsupported blocking ACP request: ${message.method}`);
        return null;
    }

    async start(): Promise<void> {
        const { command, cwd, model, mode, permissionPolicy } = this.#options;
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
        if (!supportsModel(session, expectedAcpModelId(model))) throw new Error(`Cursor ACP does not advertise required model ${model}`);
        this.#sessionId = sessionId;
        await this.#transport.request("session/set_mode", { sessionId, modeId: mode });
        this.#options.event({ type: "state", text: `session ${sessionId}` });
    }

    async runTask(prompt: string): Promise<ExternalTaskResult> {
        if (!this.#transport || !this.#sessionId) throw new Error("Cursor ACP driver is not started");
        this.#output = ""; this.#turnFailure = undefined; this.#turnActive = true; this.#turnCancelled = false;
        const blockingFailure = new Promise<never>((_resolve, reject) => { this.#rejectTurnFailure = reject; });
        try {
            const result = record(await Promise.race([this.#transport.request("session/prompt", { sessionId: this.#sessionId, prompt: [{ type: "text", text: prompt }] }, 24 * 60 * 60 * 1000), blockingFailure]));
            if (this.#turnFailure) throw this.#turnFailure;
            const stopReason = typeof result?.stopReason === "string" ? result.stopReason : "missing";
            if (stopReason !== "end_turn") throw new Error(`Cursor task stopped with ${stopReason}${this.#transport.stderr() ? `: ${this.#transport.stderr()}` : ""}`);
            return { output: this.#output || textFrom(result), stopReason };
        } finally { this.#rejectTurnFailure = undefined; this.#turnActive = false; }
    }

    async cancel(): Promise<void> { if (this.#turnActive) this.#turnCancelled = true; if (this.#transport && this.#sessionId) this.#transport.notify("session/cancel", { sessionId: this.#sessionId }); }
    partialOutput(): string { return this.#output; }
    async shutdown(): Promise<void> { await this.#transport?.shutdown(); }
    waitForClose(): Promise<Error> { return this.#transport?.waitForClose() ?? new Promise<Error>(() => {}); }
    fatalError(): Error | undefined { return this.#transport?.fatalError(); }
}
