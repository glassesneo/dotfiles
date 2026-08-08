import { AcpTransport, type JsonRpcMessage } from "./orchestration_acp.ts";
import type { ExternalDriver, ExternalTaskResult, ExternalWorkerEvent } from "./orchestration_external_driver.ts";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function scalar(value: unknown): string {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

function textFrom(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join("");
    const item = object(value);
    if (!item) return "";
    for (const key of ["text", "content", "message", "title", "name", "detail"]) {
        const text = textFrom(item[key]);
        if (text) return text;
    }
    return "";
}

function advertisedConfig(session: JsonObject, id: string): JsonObject {
    const options = session.configOptions;
    if (!Array.isArray(options)) throw new Error(`Codex ACP session/new did not advertise config option ${id}`);
    const option = options.map(object).find(candidate => candidate?.id === id);
    if (!option) throw new Error(`Codex ACP session/new did not advertise config option ${id}`);
    return option;
}

function supportsConfig(option: JsonObject, value: string): boolean {
    return Array.isArray(option.options) && option.options.some(candidate => candidate === value || object(candidate)?.value === value);
}

function supportsMode(session: JsonObject, mode: string): boolean {
    const modes = object(session.modes)?.availableModes;
    return Array.isArray(modes) && modes.some(candidate => candidate === mode || object(candidate)?.id === mode);
}

function actionableStartupError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    if (/auth|unauthoriz|login|credential/iu.test(message)) {
        return new Error(`Codex authentication is required; run 'codex-acp login' before starting the subagent (${message})`);
    }
    return error instanceof Error ? error : new Error(message);
}

export interface CodexAcpDriverOptions {
    command: string;
    cwd: string;
    model: string;
    reasoning: string;
    mode: "read-only";
    permissionPolicy: "reject";
    webSearch: "cached";
    event: (event: ExternalWorkerEvent) => void;
}

export class CodexAcpDriver implements ExternalDriver {
    readonly #options: CodexAcpDriverOptions;
    #transport?: AcpTransport;
    #sessionId?: string;
    #output = "";
    #turnFailure?: Error;
    #rejectTurnFailure?: (error: Error) => void;
    #turnActive = false;
    #turnCancelled = false;

    constructor(options: CodexAcpDriverOptions) {
        this.#options = options;
    }

    #failTurn(message: string): never {
        const error = new Error(message);
        this.#turnFailure ??= error;
        this.#rejectTurnFailure?.(error);
        throw error;
    }

    async #handle(message: JsonRpcMessage): Promise<unknown> {
        if (message.method === "session/update") {
            const params = object(message.params) ?? {};
            const update = object(params.update) ?? params;
            const kind = scalar(update.sessionUpdate) || scalar(update.type) || scalar(update.kind) || "update";
            const text = textFrom(update);
            if (kind === "agent_message_chunk" && text) {
                this.#output += text;
                this.#options.event({ type: "text", text });
            } else if (kind === "agent_thought_chunk" && text) {
                this.#options.event({ type: "thought", text });
            } else if (["tool_call", "tool_call_update", "plan", "plan_update", "plan_removed"].includes(kind)) {
                this.#options.event({ type: "tool", text: text || kind });
            }
            return null;
        }

        if (message.method === "session/request_permission") {
            if (this.#turnCancelled) {
                this.#options.event({ type: "permission", text: "cancelled permission request" });
                return { outcome: { outcome: "cancelled" } };
            }
            const options = Array.isArray(object(message.params)?.options)
                ? object(message.params)!.options as unknown[]
                : [];
            const normalized = options.map(object).filter((option): option is JsonObject => option !== undefined);
            const selected = normalized.find(option => scalar(option.kind) === "reject_once")
                ?? normalized.find(option => scalar(option.kind) === "reject_always");
            const optionId = selected?.optionId;
            if (typeof optionId !== "string" || !optionId.trim()) {
                this.#failTurn("Codex permission request has no exact reject_once or reject_always option");
            }
            this.#options.event({ type: "permission", text: `rejected ${optionId}` });
            return { outcome: { outcome: "selected", optionId } };
        }

        if (message.id !== undefined) this.#failTurn(`Unsupported blocking ACP request: ${message.method}`);
        return null;
    }

    async start(): Promise<void> {
        const reasoning = this.#options.reasoning;
        const mode = this.#options.mode;
        const permissionPolicy = this.#options.permissionPolicy;
        const webSearch = this.#options.webSearch;
        if (this.#options.model !== "gpt-5.6-luna" || reasoning !== "high") throw new Error("Codex ACP requires gpt-5.6-luna with high reasoning");
        if (mode !== "read-only") throw new Error("Codex ACP requires read-only mode");
        if (permissionPolicy !== "reject") throw new Error("Codex ACP requires reject permission policy");
        if (webSearch !== "cached") throw new Error("Codex ACP requires cached Web search");

        let inheritedConfig: JsonObject = {};
        if (process.env.CODEX_CONFIG !== undefined) {
            try {
                const parsed = JSON.parse(process.env.CODEX_CONFIG);
                const config = object(parsed);
                if (!config) throw new Error("not an object");
                inheritedConfig = config;
            } catch {
                throw new Error("Inherited CODEX_CONFIG must be a JSON object");
            }
        }
        const env = {
            ...process.env,
            INITIAL_AGENT_MODE: mode,
            NO_BROWSER: "1",
            CODEX_CONFIG: JSON.stringify({ ...inheritedConfig, mcp_servers: {}, web_search: webSearch }),
        };
        this.#options.event({ type: "state", text: `starting codex ${this.#options.model}` });
        this.#transport = new AcpTransport(this.#options.command, [], {
            cwd: this.#options.cwd,
            env,
            handler: message => this.#handle(message),
        });

        try {
            const initialized = object(await this.#transport.request("initialize", {
                protocolVersion: 1,
                clientInfo: { name: "pi-subagent-worker", version: "1" },
                clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
            }));
            if (initialized?.protocolVersion !== 1) throw new Error("Codex ACP initialize returned an unsupported protocol version");

            const session = object(await this.#transport.request("session/new", { cwd: this.#options.cwd, mcpServers: [] }));
            if (!session) throw new Error("Codex ACP session/new returned a malformed result");
            const sessionId = session.sessionId;
            if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("Codex ACP session/new returned no sessionId");
            if (!supportsMode(session, mode)) throw new Error(`Codex ACP does not advertise required mode ${mode}`);
            const model = advertisedConfig(session, "model");
            if (!supportsConfig(model, this.#options.model)) throw new Error(`Codex ACP does not advertise required model ${this.#options.model}`);

            this.#sessionId = sessionId;
            await this.#transport.request("session/set_mode", { sessionId, modeId: mode });
            const modelResult = object(await this.#transport.request("session/set_config_option", { sessionId, configId: "model", value: this.#options.model }));
            const effort = advertisedConfig(modelResult ?? {}, "reasoning_effort");
            if (!supportsConfig(effort, reasoning)) throw new Error(`Codex ACP does not advertise reasoning effort ${reasoning} for model ${this.#options.model}`);
            await this.#transport.request("session/set_config_option", { sessionId, configId: "reasoning_effort", value: reasoning });
            this.#options.event({ type: "state", text: `session ${sessionId}` });
        } catch (error) {
            throw actionableStartupError(error);
        }
    }

    async runTask(prompt: string): Promise<ExternalTaskResult> {
        if (!this.#transport || !this.#sessionId) throw new Error("Codex ACP driver is not started");
        this.#output = "";
        this.#turnFailure = undefined;
        this.#turnActive = true;
        this.#turnCancelled = false;
        const blockingFailure = new Promise<never>((_resolve, reject) => { this.#rejectTurnFailure = reject; });
        try {
            const result = object(await Promise.race([
                this.#transport.request("session/prompt", { sessionId: this.#sessionId, prompt: [{ type: "text", text: prompt }] }, 24 * 60 * 60 * 1000),
                blockingFailure,
            ]));
            if (this.#turnFailure) throw this.#turnFailure;
            const stopReason = scalar(result?.stopReason) || "missing";
            if (stopReason !== "end_turn") throw new Error(`Codex task stopped with ${stopReason}${this.#transport.stderr() ? `: ${this.#transport.stderr()}` : ""}`);
            return { output: this.#output, stopReason };
        } catch (error) {
            throw actionableStartupError(error);
        } finally {
            this.#rejectTurnFailure = undefined;
            this.#turnActive = false;
        }
    }

    async cancel(): Promise<void> {
        if (this.#turnActive) this.#turnCancelled = true;
        if (this.#transport && this.#sessionId) this.#transport.notify("session/cancel", { sessionId: this.#sessionId });
    }

    partialOutput(): string { return this.#output; }
    async shutdown(): Promise<void> { await this.#transport?.shutdown(); }
    waitForClose(): Promise<Error> { return this.#transport?.waitForClose() ?? new Promise<Error>(() => {}); }
    fatalError(): Error | undefined { return this.#transport?.fatalError(); }
}
