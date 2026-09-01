import assert from "node:assert/strict";
import test from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import {
    NATIVE_COMPACTION_RESERVE_TOKENS,
    candidateFitsContext,
    formatAggregateFallbackError,
    restoreCompatibleRoute,
    sanitizeDiagnostic,
    selectProfileCandidate,
    selectRuntimePromotion,
    type ModelRouteAttempt,
} from "../extensions_src/utilities/orchestration_profile_fallback.ts";

const profile = { models: ["provider/primary", "provider/fallback", "provider/last"], thinkingLevel: "medium" as const, harness: "pi" as const };
const model = (id: string, contextWindow = 100_000) => ({ provider: "provider", id, contextWindow }) as Model<string>;

// Admitted contract: given a compatible restored route with prior attempts, profile selection rechecks the active and later candidates without discarding or duplicating route history.
void test("restored profile selection preserves compatible attempts while advancing", async () => {
    const available = new Set(["last"]);
    const route = {
        activeIndex: 1,
        activeModel: "provider/fallback",
        attempts: [{ index: 0, model: "provider/primary", category: "unavailable" as const, at: "2026-01-01T00:00:00.000Z", message: "primary unavailable" }],
    };
    const selected = await selectProfileCandidate({
        profile,
        profileName: "ordered",
        route,
        registry: {
            find: (_provider, id) => available.has(id) ? model(id) : undefined,
        },
        activate: async () => true,
        now: () => "2026-01-01T00:00:01.000Z",
    });
    assert.equal(selected.ok, true);
    if (!selected.ok) return;
    assert.equal(selected.model.id, "last");
    assert.equal(selected.route.activeIndex, 2);
    assert.deepEqual(selected.route.attempts.map(attempt => attempt.index), [0, 1]);

    const exhausted = await selectProfileCandidate({
        profile,
        profileName: "ordered",
        route: selected.route,
        registry: { find: () => undefined },
        activate: async () => true,
        now: () => "2026-01-01T00:00:02.000Z",
    });
    assert.equal(exhausted.ok, false);
    if (exhausted.ok) return;
    assert.deepEqual(exhausted.route.attempts.map(attempt => attempt.index), [0, 1, 2]);
    assert.equal(new Set(exhausted.route.attempts.map(attempt => attempt.index)).size, 3);
    for (const candidate of profile.models) assert.match(exhausted.error, new RegExp(candidate.replace("/", "\\/"), "u"));
});

// Admitted contract: given a route whose active index or attempt history is outside the selected profile, runtime fallback settles rather than selecting an unbounded candidate.
void test("invalid route state cannot trigger runtime promotion", async () => {
    const decision = await selectRuntimePromotion({
        profile,
        profileName: "ordered",
        route: { activeIndex: 3, activeModel: "provider/unknown", attempts: [] },
        suspended: false,
        stopReason: "error",
        cancelled: false,
        shuttingDown: false,
        usageTokens: 0,
        reserveTokens: 0,
        registry: { find: (_provider, id) => model(id) },
    });
    assert.deepEqual(decision, { action: "settle" });
    assert.equal(restoreCompatibleRoute(profile, "ordered", {
        profile: "ordered",
        models: profile.models,
        route: { activeIndex: 1, activeModel: "provider/fallback", attempts: [{ index: 4, model: "provider/unknown", category: "unavailable", at: "2026-01-01T00:00:00.000Z" }] },
    }), undefined);
    assert.doesNotThrow(() => restoreCompatibleRoute(profile, "ordered", {
        profile: "ordered",
        models: "malformed" as unknown as string[],
        route: { activeIndex: 1, activeModel: "provider/fallback", attempts: [] },
    }));
});

// Mechanical validation: diagnostics are individually bounded and sanitized while aggregate exhaustion remains complete for every configured candidate.
void test("fallback diagnostics sanitize each message without truncating candidate coverage", () => {
    const attempts: ModelRouteAttempt[] = profile.models.map((modelName, index) => ({
        index,
        model: modelName,
        category: index === 1 ? "context" : "unavailable",
        at: "2026-01-01T00:00:00.000Z",
        message: `${"é".repeat(400)} token=secret-${index}`,
    }));
    const error = formatAggregateFallbackError("ordered", profile.models, attempts);
    assert.doesNotMatch(error, /secret-/u);
    for (const attempt of attempts) {
        assert.ok(Buffer.byteLength(attempt.message ?? "", "utf8") > 512);
        assert.ok(Buffer.byteLength(sanitizeDiagnostic(attempt.message), "utf8") <= 512);
        assert.doesNotMatch(sanitizeDiagnostic(attempt.message), /secret-/u);
    }
    for (const candidate of profile.models) assert.match(error, new RegExp(candidate.replace("/", "\\/"), "u"));
});

// Admitted contract: given external provider diagnostics with sensitive transport or environment material, route persistence and aggregate errors expose only a bounded generic category while retaining ordered candidates.
void test("fallback diagnostics redact representative credential-bearing provider failures", () => {
    const diagnostics = [
        "Authorization: Bearer topsecret",
        "Bearer topsecret",
        '{"headers":{"Authorization":"Bearer topsecret"},"api_key":"topsecret"}',
        '{"request":{"body":"password=topsecret"}}',
        "OPENAI_API_KEY=topsecret",
    ];
    const attempts: ModelRouteAttempt[] = diagnostics.map((message, index) => ({ index, model: profile.models[index % profile.models.length]!, category: "unavailable", at: "2026-01-01T00:00:00.000Z", message }));
    for (const diagnostic of diagnostics) {
        const safe = sanitizeDiagnostic(diagnostic);
        assert.equal(safe, "diagnostic redacted");
        assert.ok(!/topsecret|authorization|bearer|headers|body|openai_api_key/iu.test(safe));
        assert.ok(Buffer.byteLength(safe, "utf8") <= 512);
    }
    const aggregate = formatAggregateFallbackError("ordered", profile.models, attempts);
    assert.ok(!/topsecret|authorization|bearer|headers|body|openai_api_key/iu.test(aggregate));
    for (const candidate of profile.models) assert.match(aggregate, new RegExp(candidate.replace("/", "\\/"), "u"));
});

// Mechanical validation: an unavailable compaction-reserve setting does not turn the native reserve requirement into zero.
void test("context capacity uses the native reserve when no reserve is supplied", () => {
    assert.equal(NATIVE_COMPACTION_RESERVE_TOKENS, 16_384);
    assert.equal(candidateFitsContext(20_100, 4_000, undefined), false);
    assert.equal(candidateFitsContext(20_100, 4_000, 16_000), true);
});
