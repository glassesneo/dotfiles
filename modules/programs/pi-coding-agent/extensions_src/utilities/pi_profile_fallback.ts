export {
    FALLBACK_CONTINUE_CONTENT as PROFILE_FALLBACK_CONTINUATION,
    FALLBACK_CONTINUE_CUSTOM_TYPE as PROFILE_FALLBACK_CONTINUATION_TYPE,
    NATIVE_COMPACTION_RESERVE_TOKENS,
    candidateFitsContext as candidateHasContextCapacity,
    initialModelRoute as initialProfileRoute,
    promoteProfileCandidate,
    reconcileForwardIndex as reconcileProfileRoute,
    sanitizeDiagnostic as sanitizeProfileDiagnostic,
    selectProfileCandidate,
    splitProviderModel,
    type ModelRouteAttempt as ProfileAttempt,
    type ModelRouteAttemptCategory as ProfileAttemptCategory,
    type ModelRegistryLike,
    type ModelRouteState as ProfileRoute,
} from "./orchestration_profile_fallback.ts";
import { restoreCompatibleRoute, type ModelRouteState } from "./orchestration_profile_fallback.ts";
import type { ExecutionProfile } from "./mode_types.ts";

export function restoreCompatibleProfileRoute(profile: ExecutionProfile, profileName: string, value: unknown): ModelRouteState | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const raw = value as { profile?: string; models?: string[]; candidates?: string[]; route?: ModelRouteState };
    if (typeof raw.profile !== "string" || !raw.route) return undefined;
    return restoreCompatibleRoute(profile, profileName, { profile: raw.profile, models: raw.models, candidates: raw.candidates, route: raw.route });
}
