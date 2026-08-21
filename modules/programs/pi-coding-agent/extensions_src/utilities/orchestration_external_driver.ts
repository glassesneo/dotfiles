import { CURSOR_READ_HARNESS_OPTIONS, CURSOR_WRITE_HARNESS_OPTIONS, type ExecutionProfile } from "./mode_types.ts";
import { CodexAcpDriver } from "./orchestration_codex_acp.ts";
import { CursorAcpDriver } from "./orchestration_cursor_acp.ts";

export type ExternalWorkerEvent =
    | { type: "state"; text: string }
    | { type: "text"; text: string }
    | { type: "thought"; text: string }
    | { type: "tool"; text: string }
    | { type: "permission"; text: string };
export interface ExternalTaskResult { output: string; stopReason: string }
export interface ExternalDriver { start(): Promise<void>; runTask(prompt: string): Promise<ExternalTaskResult>; cancel(): Promise<void>; partialOutput?(): string; shutdown(): Promise<void>; waitForClose(): Promise<Error>; fatalError(): Error | undefined }

export interface CursorExternalWorkerConfig { adapter: "cursor-acp"; command: string; cwd: string; mode: "ask" | "agent"; permissionPolicy: "reject" | "allow-always" }
export interface CodexExternalWorkerConfig { adapter: "codex-acp"; command: string; cwd: string; mode: "read-only"; permissionPolicy: "reject"; webSearch: "cached" }
export type ExternalWorkerConfig = CursorExternalWorkerConfig | CodexExternalWorkerConfig;
export interface ExternalDriverRoute { display: string; create(event: (event: ExternalWorkerEvent) => void): ExternalDriver }

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("External worker config must be an object");
    return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
    const actual = Object.keys(value).sort();
    if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) throw new Error("External worker config keys are invalid");
}
function text(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`External worker config ${name} must be a non-empty string`);
    return value;
}

export function validateExternalWorkerConfig(value: unknown): ExternalWorkerConfig {
    const raw = object(value);
    if (raw.adapter === "cursor-acp") {
        exact(raw, ["adapter", "command", "cwd", "mode", "permissionPolicy"]);
        const read = raw.mode === "ask" && raw.permissionPolicy === "reject";
        const write = raw.mode === "agent" && raw.permissionPolicy === "allow-always";
        if (!read && !write) throw new Error("Cursor external worker mode and permissionPolicy combination is invalid");
        return { adapter: "cursor-acp", command: text(raw.command, "command"), cwd: text(raw.cwd, "cwd"), mode: raw.mode as "ask" | "agent", permissionPolicy: raw.permissionPolicy as "reject" | "allow-always" };
    }
    if (raw.adapter === "codex-acp") {
        exact(raw, ["adapter", "command", "cwd", "mode", "permissionPolicy", "webSearch"]);
        if (raw.mode !== "read-only") throw new Error("Codex external worker mode must be read-only");
        if (raw.permissionPolicy !== "reject") throw new Error("Codex external worker permissionPolicy must be reject");
        if (raw.webSearch !== "cached") throw new Error("Codex external worker webSearch must be cached");
        return { adapter: "codex-acp", command: text(raw.command, "command"), cwd: text(raw.cwd, "cwd"), mode: "read-only", permissionPolicy: "reject", webSearch: "cached" };
    }
    throw new Error(`Unsupported external worker adapter: ${String(raw.adapter)}`);
}

function exactHarnessOptions(actual: Record<string, unknown> | undefined, expected: Record<string, unknown>): boolean {
    if (!actual || Object.keys(actual).length !== Object.keys(expected).length) return false;
    return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

export function resolveExternalDriver(config: ExternalWorkerConfig, profile: ExecutionProfile): ExternalDriverRoute {
    if (config.adapter === "cursor-acp") {
        if (profile.harness !== "cursor-agent" || !profile.model.startsWith("cursor/") || profile.thinkingLevel !== undefined) throw new Error("cursor-acp requires a Cursor selected execution profile");
        const expected = config.mode === "ask" ? CURSOR_READ_HARNESS_OPTIONS : CURSOR_WRITE_HARNESS_OPTIONS;
        if (!exactHarnessOptions(profile.harnessOptions, expected)) throw new Error("cursor-acp selected execution profile has invalid harnessOptions");
        return {
            display: "cursor-agent",
            create: event => new CursorAcpDriver({ command: config.command, cwd: config.cwd, model: profile.model.slice(7), mode: config.mode, permissionPolicy: config.permissionPolicy, event }),
        };
    }
    if (profile.harness !== "codex" || !profile.model.startsWith("codex/") || !profile.thinkingLevel || !exactHarnessOptions(profile.harnessOptions, { mode: "read-only", permissionPolicy: "reject", webSearch: "cached" })) throw new Error("codex-acp requires a Codex selected execution profile");
    const options = { command: config.command, cwd: config.cwd, model: profile.model.slice("codex/".length), reasoning: profile.thinkingLevel, mode: config.mode, permissionPolicy: config.permissionPolicy, webSearch: config.webSearch } as const;
    return { display: "codex", create: event => new CodexAcpDriver({ ...options, event }) };
}
