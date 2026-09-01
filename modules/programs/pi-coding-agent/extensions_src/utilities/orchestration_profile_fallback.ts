import type { Model } from "@earendil-works/pi-ai";
import type { ExecutionProfile } from "./mode_types.ts";

export const MODEL_ROUTE_ATTEMPT_CATEGORIES = ["unavailable", "context", "invocation"] as const;
export type ModelRouteAttemptCategory = (typeof MODEL_ROUTE_ATTEMPT_CATEGORIES)[number];
export interface ModelRouteAttempt {
    index: number;
    model: string;
    category: ModelRouteAttemptCategory;
    at: string;
    message?: string;
}
export interface ModelRouteState {
    activeIndex: number;
    activeModel: string;
    attempts: ModelRouteAttempt[];
}

export const NATIVE_COMPACTION_RESERVE_TOKENS = 16_384;
export const FALLBACK_CONTINUE_CUSTOM_TYPE = "profile-fallback-continue";
export const FALLBACK_CONTINUE_CONTENT = "Continue the active task from the existing conversation and completed tool results. The prior model route could not complete the next model call. Do not repeat completed work.";
const REDACTED_DIAGNOSTIC = "diagnostic redacted";

export interface ModelRegistryLike {
    find(provider: string, modelId: string): Model<string> | undefined;
    hasConfiguredAuth?(model: Model<string>): boolean;
    getApiKeyAndHeaders?(model: Model<string>): Promise<{ ok: boolean; error?: string }>;
}

export function splitProviderModel(model: string): [string, string] {
    const at = model.indexOf("/");
    return at < 0 ? ["", model] : [model.slice(0, at), model.slice(at + 1)];
}

export function selectedProfileModel(profile: ExecutionProfile, index = 0): string {
    const model = profile.models[index] ?? profile.models[0];
    if (!model) throw new Error("Execution profile has no models");
    return model;
}

export function initialModelRoute(profile: ExecutionProfile, index: number): ModelRouteState {
    if (!Number.isInteger(index) || index < 0 || index >= profile.models.length) throw new Error("initial candidate index is outside the profile models");
    return { activeIndex: index, activeModel: profile.models[index]!, attempts: [], };
}

export function sanitizeDiagnostic(value: unknown): string {
    const raw = value instanceof Error ? value.message : typeof value === "string" ? value : "";
    return raw.trim() ? REDACTED_DIAGNOSTIC : "";
}

export function validateModelRouteState(value: unknown, label = "modelRoute"): ModelRouteState {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    const raw = value as Record<string, unknown>;
    const unknown = Object.keys(raw).filter(key => !["activeIndex", "activeModel", "attempts"].includes(key));
    if (unknown.length) throw new Error(`${label} contains unknown keys: ${unknown.join(", ")}`);
    if (!Number.isInteger(raw.activeIndex) || Number(raw.activeIndex) < 0) throw new Error(`${label}.activeIndex must be a non-negative integer`);
    if (typeof raw.activeModel !== "string" || !/^[^/\s]+\/\S+$/u.test(raw.activeModel)) throw new Error(`${label}.activeModel must use provider/model format`);
    if (!Array.isArray(raw.attempts)) throw new Error(`${label}.attempts must be an array`);
    const attempts: ModelRouteAttempt[] = [];
    const seen = new Set<number>();
    for (const [offset, item] of raw.attempts.entries()) {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label}.attempts[${offset}] must be an object`);
        const attempt = item as Record<string, unknown>;
        const extra = Object.keys(attempt).filter(key => !["index", "model", "category", "at", "message"].includes(key));
        if (extra.length) throw new Error(`${label}.attempts[${offset}] contains unknown keys: ${extra.join(", ")}`);
        if (!Number.isInteger(attempt.index) || Number(attempt.index) < 0) throw new Error(`${label}.attempts[${offset}].index must be a non-negative integer`);
        if (seen.has(Number(attempt.index))) throw new Error(`${label}.attempts must not repeat a candidate index`);
        seen.add(Number(attempt.index));
        if (typeof attempt.model !== "string" || !/^[^/\s]+\/\S+$/u.test(attempt.model)) throw new Error(`${label}.attempts[${offset}].model must use provider/model format`);
        if (!MODEL_ROUTE_ATTEMPT_CATEGORIES.includes(attempt.category as never)) throw new Error(`${label}.attempts[${offset}].category is invalid`);
        if (typeof attempt.at !== "string" || !Number.isFinite(Date.parse(attempt.at))) throw new Error(`${label}.attempts[${offset}].at must be an ISO timestamp`);
        const message = attempt.message === undefined ? undefined : sanitizeDiagnostic(attempt.message);
        attempts.push({ index: Number(attempt.index), model: attempt.model, category: attempt.category as ModelRouteAttemptCategory, at: attempt.at, ...(message ? { message } : {}) });
    }
    return { activeIndex: Number(raw.activeIndex), activeModel: raw.activeModel, attempts };
}

export function formatAggregateFallbackError(profileName: string, models: readonly string[], attempts: readonly ModelRouteAttempt[]): string {
    const byIndex = new Map(attempts.map(attempt => [attempt.index, attempt]));
    const parts = models.map((model, index) => {
        const attempt = byIndex.get(index);
        if (!attempt) return `${model} (untried)`;
        const message = attempt.message === undefined ? undefined : sanitizeDiagnostic(attempt.message);
        return `${model} (${attempt.category}${message ? `: ${message}` : ""})`;
    });
    return `Profile ${sanitizeDiagnostic(profileName)} fallback exhausted: ${parts.join("; ")}`;
}

export function recordModelRouteAttempt(route: ModelRouteState, attempt: ModelRouteAttempt): ModelRouteState {
    if (route.attempts.some(item => item.index === attempt.index)) return route;
    const message = attempt.message === undefined ? undefined : sanitizeDiagnostic(attempt.message);
    const normalized = { ...attempt, ...(message ? { message } : {}) };
    return { ...route, attempts: [...route.attempts, normalized] };
}

async function inspectCandidate(registry: ModelRegistryLike, model: string, now: () => string, index: number): Promise<{ ok: true; resolved: Model<string> } | { ok: false; attempt: ModelRouteAttempt }> {
    const [provider, modelId] = splitProviderModel(model);
    const resolved = registry.find(provider, modelId);
    if (!resolved) return { ok: false, attempt: { index, model, category: "unavailable", at: now(), message: sanitizeDiagnostic("not in registry") } };
    try {
        if (registry.hasConfiguredAuth && !registry.hasConfiguredAuth(resolved)) return { ok: false, attempt: { index, model, category: "unavailable", at: now(), message: sanitizeDiagnostic("auth is not configured") } };
        if (registry.getApiKeyAndHeaders) {
            const auth = await registry.getApiKeyAndHeaders(resolved);
            if (!auth.ok) return { ok: false, attempt: { index, model, category: "unavailable", at: now(), message: sanitizeDiagnostic(auth.error ?? "credential resolution failed") } };
        }
        return { ok: true, resolved };
    } catch (error) {
        return { ok: false, attempt: { index, model, category: "unavailable", at: now(), message: sanitizeDiagnostic(error) } };
    }
}

function routeMatchesProfile(profile: ExecutionProfile, route: ModelRouteState): boolean {
    try {
        const validated = validateModelRouteState(route);
        if (validated.activeIndex >= profile.models.length || validated.activeModel !== profile.models[validated.activeIndex]) return false;
        return validated.attempts.every(attempt => profile.models[attempt.index] === attempt.model);
    } catch {
        return false;
    }
}

export async function preflightProfileCandidates(input: {
    profile: ExecutionProfile;
    profileName: string;
    registry: ModelRegistryLike;
    route?: ModelRouteState;
    startIndex?: number;
    setModel?: (model: Model<string>) => Promise<boolean>;
    now?: () => string;
}): Promise<{ ok: true; route: ModelRouteState; model: Model<string> } | { ok: false; error: string; route: ModelRouteState }> {
    const now = input.now ?? (() => new Date().toISOString());
    const suppliedRoute = input.route && routeMatchesProfile(input.profile, input.route) ? validateModelRouteState(input.route) : undefined;
    const requestedStartIndex = suppliedRoute?.activeIndex ?? input.startIndex ?? 0;
    const startIndex = Number.isInteger(requestedStartIndex) && requestedStartIndex >= 0 && requestedStartIndex < input.profile.models.length ? requestedStartIndex : 0;
    let route: ModelRouteState = suppliedRoute ? { ...suppliedRoute, attempts: [...suppliedRoute.attempts] } : { activeIndex: startIndex, activeModel: input.profile.models[startIndex] ?? input.profile.models[0] ?? "", attempts: [] };
    for (let index = startIndex; index < input.profile.models.length; index += 1) {
        const model = input.profile.models[index]!;
        const inspected = await inspectCandidate(input.registry, model, now, index);
        if (!inspected.ok) { route = recordModelRouteAttempt(route, inspected.attempt); continue; }
        if (input.setModel) {
            try {
                if (!await input.setModel(inspected.resolved)) { route = recordModelRouteAttempt(route, { index, model, category: "unavailable", at: now(), message: sanitizeDiagnostic("setModel returned false") }); continue; }
            } catch (error) {
                route = recordModelRouteAttempt(route, { index, model, category: "unavailable", at: now(), message: sanitizeDiagnostic(error) });
                continue;
            }
        }
        route = { activeIndex: index, activeModel: model, attempts: route.attempts };
        return { ok: true, route, model: inspected.resolved };
    }
    return { ok: false, error: formatAggregateFallbackError(input.profileName, input.profile.models, route.attempts), route };
}

export function restoreCompatibleRoute(profile: ExecutionProfile, profileName: string, persisted: { profile: string; candidates?: readonly string[]; models?: readonly string[]; route: ModelRouteState } | undefined): ModelRouteState | undefined {
    if (!persisted || persisted.profile !== profileName) return undefined;
    const list = persisted.candidates ?? persisted.models;
    if (!Array.isArray(list) || list.length !== profile.models.length || list.some((model, index) => model !== profile.models[index])) return undefined;
    return routeMatchesProfile(profile, persisted.route) ? validateModelRouteState(persisted.route) : undefined;
}

export function reconcileForwardIndex(profile: ExecutionProfile, route: ModelRouteState, currentModel: string | undefined): ModelRouteState {
    if (!currentModel) return route;
    const currentIndex = profile.models.indexOf(currentModel);
    if (currentIndex > route.activeIndex) return { ...route, activeIndex: currentIndex, activeModel: currentModel };
    return route;
}

export function candidateFitsContext(contextWindow: number, usageTokens: number | null | undefined, reserveTokens: number | undefined): boolean {
    if (usageTokens === null || usageTokens === undefined) return true;
    const required = usageTokens + (reserveTokens ?? NATIVE_COMPACTION_RESERVE_TOKENS);
    return contextWindow > required;
}

export async function selectRuntimePromotion(input: {
    profile: ExecutionProfile;
    profileName: string;
    route: ModelRouteState;
    suspended: boolean;
    stopReason: string | undefined;
    cancelled: boolean;
    shuttingDown: boolean;
    usageTokens: number | null | undefined;
    reserveTokens: number | undefined;
    registry: ModelRegistryLike;
    errorMessage?: string;
    now?: () => string;
}): Promise<{ action: "settle" } | { action: "promote"; route: ModelRouteState; model: Model<string> } | { action: "exhausted"; route: ModelRouteState; error: string }> {
    if (input.cancelled || input.shuttingDown || input.suspended || input.stopReason !== "error" || !routeMatchesProfile(input.profile, input.route)) return { action: "settle" };
    const now = input.now ?? (() => new Date().toISOString());
    let route = recordModelRouteAttempt(input.route, { index: input.route.activeIndex, model: input.route.activeModel, category: "invocation", at: now(), message: sanitizeDiagnostic(input.errorMessage) || undefined });
    for (let index = input.route.activeIndex + 1; index < input.profile.models.length; index += 1) {
        if (route.attempts.some(attempt => attempt.index === index)) continue;
        const model = input.profile.models[index]!;
        const inspected = await inspectCandidate(input.registry, model, now, index);
        if (!inspected.ok) { route = recordModelRouteAttempt(route, inspected.attempt); continue; }
        if (!candidateFitsContext(inspected.resolved.contextWindow, input.usageTokens, input.reserveTokens)) {
            route = recordModelRouteAttempt(route, { index, model, category: "context", at: now(), message: sanitizeDiagnostic("context window cannot hold current tokens plus compaction reserve") });
            continue;
        }
        route = { activeIndex: index, activeModel: model, attempts: route.attempts };
        return { action: "promote", route, model: inspected.resolved };
    }
    return { action: "exhausted", route, error: formatAggregateFallbackError(input.profileName, input.profile.models, route.attempts) };
}

export async function selectProfileCandidate(input: {
    profile: ExecutionProfile;
    profileName: string;
    registry: ModelRegistryLike;
    route?: ModelRouteState;
    activate: (model: Model<string>) => Promise<boolean>;
    now?: () => string;
}): Promise<{ ok: true; route: ModelRouteState; model: Model<string> } | { ok: false; route: ModelRouteState; error: string }> {
    return preflightProfileCandidates({ profile: input.profile, profileName: input.profileName, registry: input.registry, route: input.route, setModel: input.activate, now: input.now });
}

export async function promoteProfileCandidate(input: {
    profile: ExecutionProfile;
    profileName: string;
    route: ModelRouteState;
    registry: ModelRegistryLike;
    tokens: number | null | undefined;
    reserveTokens?: number;
    error?: unknown;
    activate: (model: Model<string>) => Promise<boolean>;
    now?: () => string;
}): Promise<{ action: "promote"; route: ModelRouteState; model: Model<string> } | { action: "exhausted"; route: ModelRouteState; error: string }> {
    let current = input.route;
    while (true) {
        const decision = await selectRuntimePromotion({
            profile: input.profile, profileName: input.profileName, route: current, suspended: false,
            stopReason: "error", cancelled: false, shuttingDown: false,
            usageTokens: input.tokens, reserveTokens: input.reserveTokens ?? NATIVE_COMPACTION_RESERVE_TOKENS,
            registry: input.registry, errorMessage: input.error === undefined ? undefined : sanitizeDiagnostic(input.error), now: input.now,
        });
        if (decision.action === "settle" || decision.action === "exhausted") return decision.action === "settle" ? { action: "exhausted", route: current, error: formatAggregateFallbackError(input.profileName, input.profile.models, current.attempts) } : decision;
        try {
            if (!await input.activate(decision.model)) {
                current = recordModelRouteAttempt(decision.route, { index: decision.route.activeIndex, model: decision.route.activeModel, category: "unavailable", at: (input.now ?? (() => new Date().toISOString()))(), message: sanitizeDiagnostic("setModel returned false") });
                continue;
            }
        } catch (error) {
            current = recordModelRouteAttempt(decision.route, { index: decision.route.activeIndex, model: decision.route.activeModel, category: "unavailable", at: (input.now ?? (() => new Date().toISOString()))(), message: sanitizeDiagnostic(error) });
            continue;
        }
        return { action: "promote", route: decision.route, model: decision.model };
    }
}
