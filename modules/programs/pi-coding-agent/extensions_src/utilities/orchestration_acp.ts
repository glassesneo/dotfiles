import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { createInterface } from "node:readline";

export interface JsonRpcMessage { jsonrpc: "2.0"; id?: string | number; method: string; params?: unknown }
export type JsonRpcHandler = (message: JsonRpcMessage) => unknown;
export type AcpSpawn = (command: string, args: string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;

export const ACP_TERMINATE_GRACE_MS = 2000;
export const ACP_EXIT_CONFIRM_MS = 2000;

interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout; onSettled?: () => void }

export interface AcpTransportOptions {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    handler: JsonRpcHandler;
    spawn?: AcpSpawn;
    terminateGraceMs?: number;
    exitConfirmMs?: number;
}

export class AcpTransport {
    readonly process: ChildProcessWithoutNullStreams;
    readonly #pending = new Map<number, Pending>();
    readonly #handler: JsonRpcHandler;
    readonly #terminateGraceMs: number;
    readonly #exitConfirmMs: number;
    #nextId = 1;
    #stderr = "";
    #protocolError?: Error;
    #exitError?: Error;
    readonly #exitPromise: Promise<Error>;
    readonly #resolveExit: (error: Error) => void;

    constructor(command: string, args: string[], options: AcpTransportOptions) {
        let resolveExit!: (error: Error) => void;
        this.#exitPromise = new Promise(resolve => { resolveExit = resolve; });
        this.#resolveExit = resolveExit;
        this.#handler = options.handler;
        this.#terminateGraceMs = options.terminateGraceMs ?? ACP_TERMINATE_GRACE_MS;
        this.#exitConfirmMs = options.exitConfirmMs ?? ACP_EXIT_CONFIRM_MS;
        const spawnProcess = options.spawn ?? spawn;
        this.process = spawnProcess(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
        this.process.stderr.setEncoding("utf8");
        this.process.stderr.on("data", chunk => { this.#stderr = `${this.#stderr}${String(chunk)}`.slice(-16_384); });
        this.process.stdin.on("error", error => this.#failProtocol(new Error(`ACP stdin error: ${error.message}`)));
        const lines = createInterface({ input: this.process.stdout });
        lines.on("line", line => { void this.#receive(line); });
        this.process.on("error", error => this.#failProtocol(new Error(`ACP process error: ${error.message}`)));
        this.process.on("exit", (code, signal) => this.#observeExit(new Error(`ACP process exited (${signal ?? code ?? "unknown"})${this.#stderr.trim() ? `: ${this.#stderr.trim()}` : ""}`)));
    }

    stderr(): string { return this.#stderr.trim(); }
    fatalError(): Error | undefined { return this.#protocolError ?? this.#exitError; }
    exitObserved(): boolean { return this.#exitError !== undefined; }
    waitForClose(): Promise<Error> { return this.#exitPromise; }

    async #receive(line: string): Promise<void> {
        if (this.fatalError()) return;
        let raw: unknown;
        try { raw = JSON.parse(line); }
        catch { this.#failProtocol(new Error(`Malformed ACP JSON-RPC message: ${line.slice(0, 500)}`)); return; }
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) { this.#failProtocol(new Error("Malformed ACP JSON-RPC message: expected object")); return; }
        const message = raw as Record<string, unknown>;
        if (message.jsonrpc !== "2.0") { this.#failProtocol(new Error("Malformed ACP JSON-RPC message: unsupported jsonrpc version")); return; }
        if (message.id !== undefined && ("result" in message || "error" in message)) {
            const id = typeof message.id === "number" ? message.id : Number.NaN;
            const pending = this.#pending.get(id);
            if (!pending) return;
            this.#pending.delete(id);
            clearTimeout(pending.timer);
            pending.onSettled?.();
            if (message.error) pending.reject(new Error(`ACP request failed: ${JSON.stringify(message.error)}${this.stderr() ? `: ${this.stderr()}` : ""}`));
            else pending.resolve(message.result);
            return;
        }
        if (typeof message.method !== "string") { this.#failProtocol(new Error("Malformed ACP JSON-RPC message: method is missing")); return; }
        const request = message as unknown as JsonRpcMessage;
        try {
            const result = await this.#handler(request);
            if (message.id !== undefined) this.#write({ jsonrpc: "2.0", id: message.id, result: result ?? null });
        } catch (error) {
            if (message.id !== undefined) this.#write({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
            else this.#failProtocol(error instanceof Error ? error : new Error(String(error)));
        }
    }

    #write(value: unknown): void {
        if (this.fatalError()) return;
        try {
            this.process.stdin.write(`${JSON.stringify(value)}\n`);
        } catch (error) {
            this.#failProtocol(error instanceof Error ? new Error(`ACP stdin error: ${error.message}`) : new Error(`ACP stdin error: ${String(error)}`));
        }
    }

    request(method: string, params: unknown, timeoutMs = 30_000, onSettled?: () => void): Promise<unknown> {
        const closed = this.fatalError();
        if (closed) return Promise.reject(closed);
        const id = this.#nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`ACP request timed out: ${method}`)); }, timeoutMs);
            this.#pending.set(id, { resolve, reject, timer, onSettled });
            this.#write({ jsonrpc: "2.0", id, method, params });
        });
    }

    notify(method: string, params: unknown): void { this.#write({ jsonrpc: "2.0", method, params }); }

    #rejectPending(error: Error): void {
        for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
        this.#pending.clear();
    }

    #failProtocol(error: Error): void {
        if (this.#protocolError) return;
        this.#protocolError = error;
        this.#rejectPending(error);
    }

    #observeExit(error: Error): void {
        if (this.#exitError) return;
        this.#exitError = error;
        this.#protocolError ??= error;
        this.#rejectPending(error);
        this.#resolveExit(error);
    }

    #waitForExit(timeoutMs: number): Promise<boolean> {
        if (this.exitObserved()) return Promise.resolve(true);
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(false), timeoutMs);
            void this.#exitPromise.then(() => { clearTimeout(timer); resolve(true); });
        });
    }

    async shutdown(): Promise<void> {
        if (this.exitObserved() || this.process.exitCode !== null || this.process.signalCode !== null) {
            if (!this.exitObserved()) await this.#exitPromise;
            return;
        }
        try { this.process.kill("SIGTERM"); }
        catch { /* process already gone */ }
        if (await this.#waitForExit(this.#terminateGraceMs)) return;
        try { this.process.kill("SIGKILL"); }
        catch { /* process already gone */ }
        if (await this.#waitForExit(this.#exitConfirmMs)) return;
        throw new Error("ACP process exit was not confirmed");
    }
}
