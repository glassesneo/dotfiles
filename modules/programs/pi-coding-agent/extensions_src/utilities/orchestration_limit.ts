/** Classify child invocation failures before redaction. Unknown strings are never treated as quota. */

export const LIMIT_CLASS_VALUES = ["limit", "auth", "transport", "protocol", "other"] as const;
export type LimitClass = (typeof LIMIT_CLASS_VALUES)[number];

export interface ClassifiedFailure {
    class: LimitClass;
    code?: string;
    resumeEligible: boolean;
    resetAt?: string;
    observedAt: string;
}

const USAGE_LIMIT_REACHED = "usage_limit_reached";
const CHATGPT_USAGE_LIMIT = /you have hit your chatgpt usage limit/iu;
const HTTP_STATUS = /\b(?:HTTP[/\s-]?)?(\d{3})\b/u;

function usageLimitFromData(data: unknown): boolean {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const raw = data as Record<string, unknown>;
    return raw.code === USAGE_LIMIT_REACHED || raw.type === USAGE_LIMIT_REACHED || raw.reason === USAGE_LIMIT_REACHED;
}

export function classifyInvocationFailure(input: {
    errorMessage?: string;
    code?: string;
    httpStatus?: number;
    jsonRpcCode?: number;
    jsonRpcData?: unknown;
    transportBroken?: boolean;
    now?: () => string;
}): ClassifiedFailure {
    const observedAt = (input.now ?? (() => new Date().toISOString()))();
    if (input.transportBroken) return { class: "transport", resumeEligible: false, observedAt };
    if (input.code === USAGE_LIMIT_REACHED || usageLimitFromData(input.jsonRpcData)) return { class: "limit", code: USAGE_LIMIT_REACHED, resumeEligible: true, observedAt };
    if ((typeof input.httpStatus === "number" && input.httpStatus === 401) || input.httpStatus === 403) return { class: "auth", code: String(input.httpStatus), resumeEligible: false, observedAt };
    if (typeof input.jsonRpcCode === "number" && input.jsonRpcCode === -32000) return { class: "protocol", code: String(input.jsonRpcCode), resumeEligible: false, observedAt };
    const message = input.errorMessage?.trim() ?? "";
    if (CHATGPT_USAGE_LIMIT.test(message)) return { class: "limit", code: USAGE_LIMIT_REACHED, resumeEligible: true, observedAt };
    const status = input.httpStatus ?? (message.match(HTTP_STATUS) ? Number(message.match(HTTP_STATUS)![1]) : undefined);
    if (status === 401 || status === 403) return { class: "auth", code: String(status), resumeEligible: false, observedAt };
    if (status === 429) return { class: "other", code: "429", resumeEligible: false, observedAt };
    return { class: "other", resumeEligible: false, observedAt };
}

export interface LimitAttemptRecord extends ClassifiedFailure {
    cycle: number;
    candidateIndex: number;
    model: string;
}

export function hasRecoverableLimit(failures: readonly ClassifiedFailure[]): boolean {
    return failures.some(failure => failure.class === "limit" && failure.resumeEligible);
}

export function recoverableLimitInCycle(history: readonly LimitAttemptRecord[], cycle: number): boolean {
    return hasRecoverableLimit(history.filter(attempt => attempt.cycle === cycle));
}

export function limitAttemptRecord(input: {
    cycle: number;
    candidateIndex: number;
    model: string;
    failure: ClassifiedFailure;
}): LimitAttemptRecord {
    return { cycle: input.cycle, candidateIndex: input.candidateIndex, model: input.model, ...input.failure };
}
