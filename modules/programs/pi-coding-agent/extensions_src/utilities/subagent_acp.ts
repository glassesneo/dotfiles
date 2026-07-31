import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export interface JsonRpcMessage { jsonrpc: "2.0"; id?: string | number; method: string; params?: unknown }
export type JsonRpcHandler = (message: JsonRpcMessage) => unknown;

interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }

export class AcpTransport {
    readonly process: ChildProcessWithoutNullStreams;
    readonly #pending = new Map<number, Pending>();
    readonly #handler: JsonRpcHandler;
    #nextId = 1;
    #stderr = "";
    #closed?: Error;
    readonly #closedPromise: Promise<Error>;
    readonly #resolveClosed: (error: Error) => void;

    constructor(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; handler: JsonRpcHandler }) {
        let resolveClosed!: (error: Error) => void;
        this.#closedPromise = new Promise(resolve => { resolveClosed = resolve; });
        this.#resolveClosed = resolveClosed;
        this.#handler = options.handler;
        this.process = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
        this.process.stderr.setEncoding("utf8");
        this.process.stderr.on("data", chunk => { this.#stderr = `${this.#stderr}${String(chunk)}`.slice(-16_384); });
        const lines = createInterface({ input: this.process.stdout });
        lines.on("line", line => { void this.#receive(line); });
        this.process.on("error", error => this.#close(new Error(`ACP process error: ${error.message}`)));
        this.process.on("exit", (code, signal) => this.#close(new Error(`ACP process exited (${signal ?? code ?? "unknown"})${this.#stderr.trim() ? `: ${this.#stderr.trim()}` : ""}`)));
    }

    stderr(): string { return this.#stderr.trim(); }
    fatalError(): Error | undefined { return this.#closed; }
    waitForClose(): Promise<Error> { return this.#closedPromise; }

    async #receive(line: string): Promise<void> {
        let raw: unknown;
        try { raw = JSON.parse(line); }
        catch { this.#close(new Error(`Malformed ACP JSON-RPC message: ${line.slice(0, 500)}`)); return; }
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) { this.#close(new Error("Malformed ACP JSON-RPC message: expected object")); return; }
        const message = raw as Record<string, unknown>;
        if (message.jsonrpc !== "2.0") { this.#close(new Error("Malformed ACP JSON-RPC message: unsupported jsonrpc version")); return; }
        if (message.id !== undefined && ("result" in message || "error" in message)) {
            const id = typeof message.id === "number" ? message.id : Number.NaN;
            const pending = this.#pending.get(id);
            if (!pending) return;
            this.#pending.delete(id);
            clearTimeout(pending.timer);
            if (message.error) pending.reject(new Error(`ACP request failed: ${JSON.stringify(message.error)}${this.stderr() ? `: ${this.stderr()}` : ""}`));
            else pending.resolve(message.result);
            return;
        }
        if (typeof message.method !== "string") { this.#close(new Error("Malformed ACP JSON-RPC message: method is missing")); return; }
        const request = message as unknown as JsonRpcMessage;
        try {
            const result = await this.#handler(request);
            if (message.id !== undefined) this.#write({ jsonrpc: "2.0", id: message.id, result: result ?? null });
        } catch (error) {
            if (message.id !== undefined) this.#write({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
            else this.#close(error instanceof Error ? error : new Error(String(error)));
        }
    }

    #write(value: unknown): void {
        if (this.#closed) throw this.#closed;
        this.process.stdin.write(`${JSON.stringify(value)}\n`);
    }

    request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
        if (this.#closed) return Promise.reject(this.#closed);
        const id = this.#nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`ACP request timed out: ${method}`)); }, timeoutMs);
            this.#pending.set(id, { resolve, reject, timer });
            this.#write({ jsonrpc: "2.0", id, method, params });
        });
    }

    notify(method: string, params: unknown): void { this.#write({ jsonrpc: "2.0", method, params }); }

    #close(error: Error): void {
        if (this.#closed) return;
        this.#closed = error;
        this.#resolveClosed(error);
        for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
        this.#pending.clear();
    }

    async shutdown(): Promise<void> {
        if (this.process.exitCode !== null || this.process.signalCode !== null) return;
        this.process.kill("SIGTERM");
        await new Promise<void>(resolve => { const timer = setTimeout(() => { this.process.kill("SIGKILL"); resolve(); }, 2000); this.process.once("exit", () => { clearTimeout(timer); resolve(); }); });
    }
}
