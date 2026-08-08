import { AcpTransport, type JsonRpcMessage } from "./orchestration_acp.ts";
import type { ExternalDriver, ExternalTaskResult, ExternalWorkerEvent } from "./orchestration_external_driver.ts";

function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function scalar(value: unknown): string { return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : ""; }
function textFrom(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join("");
    const item = record(value);
    if (!item) return "";
    if (typeof item.text === "string") return item.text;
    if (item.content !== undefined) return textFrom(item.content);
    return "";
}

export class CursorAcpDriver implements ExternalDriver {
    readonly #command: string;
    readonly #cwd: string;
    readonly #model: string;
    readonly #permissionPolicy: string;
    readonly #event: (event: ExternalWorkerEvent) => void;
    #transport?: AcpTransport;
    #sessionId?: string;
    #output = "";
    #turnFailure?: Error;

    constructor(options: { command: string; cwd: string; model: string; permissionPolicy: string; event: (event: ExternalWorkerEvent) => void }) {
        this.#command = options.command;
        this.#cwd = options.cwd;
        this.#model = options.model;
        this.#permissionPolicy = options.permissionPolicy;
        this.#event = options.event;
    }

    #failTurn(message: string): never { const error = new Error(message); this.#turnFailure ??= error; throw error; }

    async #message(message: JsonRpcMessage): Promise<unknown> {
        if (message.method === "session/update") {
            const update = record(record(message.params)?.update) ?? record(message.params) ?? {};
            const kind = scalar(update.sessionUpdate) || scalar(update.type) || scalar(update.kind) || "update";
            const text = textFrom(update);
            if (/agent_message|message_chunk|agentMessage/iu.test(kind) && text) { this.#output += text; this.#event({ type: "text", text }); }
            else if (/thought/iu.test(kind) && text) this.#event({ type: "thought", text });
            else if (/tool|plan|mode/iu.test(kind)) this.#event({ type: "tool", text: text || kind });
            return null;
        }
        if (message.method === "session/request_permission") {
            const options = Array.isArray(record(message.params)?.options) ? record(message.params)!.options as unknown[] : [];
            const normalized = options.map(option => record(option)).filter((option): option is Record<string, unknown> => option !== undefined);
            const kind = (option: Record<string, unknown>) => scalar(option.kind);
            const alwaysKinds = new Set(["allow_always", "allow-always"]);
            const onceKinds = new Set(["allow_once", "allow-once"]);
            const preferred = normalized.find(option => this.#permissionPolicy === "allow-always" && alwaysKinds.has(kind(option)))
                ?? normalized.find(option => onceKinds.has(kind(option)));
            if (!preferred) this.#failTurn("Cursor requested permission without an exact allow-always or allow-once option");
            const optionId = preferred.optionId;
            if (typeof optionId !== "string" || !optionId.trim()) this.#failTurn("Cursor permission option has no non-blank optionId");
            this.#event({ type: "permission", text: `selected ${optionId}` });
            return { outcome: { outcome: "selected", optionId } };
        }
        if (message.method === "cursor/create_plan") { this.#event({ type: "tool", text: "accepted implementation plan" }); return { accepted: true }; }
        if (message.method === "cursor/ask_question") { this.#event({ type: "tool", text: "skipped blocking question; report blocker in result" }); return { skipped: true, reason: "non-interactive mesh agent" }; }
        if (message.id !== undefined) this.#failTurn(`Unsupported blocking ACP request: ${message.method}`);
        return null;
    }

    async start(): Promise<void> {
        this.#event({ type: "state", text: `starting cursor-agent ${this.#model}` });
        this.#transport = new AcpTransport(this.#command, ["--model", this.#model, "--force", "--sandbox", "disabled", "--trust", "acp"], {
            cwd: this.#cwd,
            handler: message => this.#message(message),
        });
        const initialized = record(await this.#transport.request("initialize", {
            protocolVersion: 1,
            clientInfo: { name: "pi-mesh-worker", version: "1" },
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        }));
        const methods = Array.isArray(initialized?.authMethods) ? initialized.authMethods : [];
        if (methods.length > 0) {
            const first = record(methods[0]);
            const methodId = first?.id ?? first?.methodId;
            if (typeof methodId !== "string") throw new Error("Cursor ACP authentication method is malformed");
            await this.#transport.request("authenticate", { methodId });
        }
        const created = record(await this.#transport.request("session/new", { cwd: this.#cwd, mcpServers: [] }));
        const sessionId = created?.sessionId;
        if (typeof sessionId !== "string" || !sessionId) throw new Error("Cursor ACP session/new returned no sessionId");
        this.#sessionId = sessionId;
        this.#event({ type: "state", text: `session ${sessionId}` });
    }

    async runTask(prompt: string): Promise<ExternalTaskResult> {
        if (!this.#transport || !this.#sessionId) throw new Error("Cursor ACP driver is not started");
        this.#output = "";
        this.#turnFailure = undefined;
        const result = record(await this.#transport.request("session/prompt", { sessionId: this.#sessionId, prompt: [{ type: "text", text: prompt }] }, 24 * 60 * 60 * 1000));
        if (this.#turnFailure) throw this.#turnFailure;
        const stopReason = typeof result?.stopReason === "string" ? result.stopReason : "missing";
        if (stopReason !== "end_turn") throw new Error(`Cursor task stopped with ${stopReason}${this.#transport.stderr() ? `: ${this.#transport.stderr()}` : ""}`);
        return { output: this.#output || textFrom(result), stopReason };
    }

    async cancel(): Promise<void> {
        if (this.#transport && this.#sessionId) this.#transport.notify("session/cancel", { sessionId: this.#sessionId });
    }
    partialOutput(): string { return this.#output; }
    async shutdown(): Promise<void> { await this.#transport?.shutdown(); }
    waitForClose(): Promise<Error> { return this.#transport?.waitForClose() ?? new Promise(() => {}); }
    fatalError(): Error | undefined { return this.#transport?.fatalError(); }
}
