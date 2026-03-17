/* ink_phosphor.glsl — Ghostty custom shader
 *   Dark ink ring from previous cursor + warm phosphor trail to current cursor.
 *   Idle frames fall through to a single texture fetch. */

/* ───── Tunables ───────────────────────────────────────────────────────── */
const float INK_DURATION   = 0.30;
const float INK_SPEED      = 350.0;
const float INK_RING_WIDTH = 12.0;
const float INK_OPACITY    = 0.15;
const vec3  INK_COLOR      = vec3(0.11, 0.11, 0.18);

const float TRAIL_DURATION = 0.25;
const float TRAIL_WIDTH    = 8.0;
const float TRAIL_OPACITY  = 0.45;
const vec3  TRAIL_COLOR    = vec3(1.0, 0.92, 0.82);

const float MOVE_THRESHOLD = 0.5;
/* ──────────────────────────────────────────────────────────────────────── */

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv   = fragCoord / iResolution.xy;
    vec4 base = texture(iChannel0, uv);
    float t   = iTime - iTimeCursorChange;

    /* idle fast-path: both effects expired → passthrough */
    if (t > max(INK_DURATION, TRAIL_DURATION)) {
        fragColor = base;
        return;
    }

    /* derive cursor centers (already in fragCoord space) */
    vec2 prevCenter = iPreviousCursor.xy + iPreviousCursor.zw * 0.5;
    vec2 curCenter  = iCurrentCursor.xy  + iCurrentCursor.zw * 0.5;

    /* sub-threshold guard: no movement → passthrough */
    if (length(curCenter - prevCenter) < MOVE_THRESHOLD) {
        fragColor = base;
        return;
    }

    vec3 color = base.rgb;

    /* ── Ink ring (dark expanding ring from previous cursor) ──────── */
    if (t < INK_DURATION) {
        float dist   = length(fragCoord - prevCenter);
        float radius = INK_SPEED * t;
        float band   = smoothstep(INK_RING_WIDTH, 0.0, abs(dist - radius));
        float fade   = (1.0 - t / INK_DURATION);
        fade *= fade; /* quadratic */
        float inkAlpha = band * fade * INK_OPACITY;
        color = mix(color, INK_COLOR, inkAlpha);
    }

    /* ── Phosphor trail (warm glow along prev→cur segment) ───────── */
    if (t < TRAIL_DURATION) {
        vec2  seg   = curCenter - prevCenter;
        float segL  = length(seg);
        vec2  segD  = seg / segL;
        float proj  = clamp(dot(fragCoord - prevCenter, segD), 0.0, segL);
        vec2  closest = prevCenter + segD * proj;
        float dist  = length(fragCoord - closest);
        float glow  = smoothstep(TRAIL_WIDTH, 0.0, dist);
        float along = proj / segL; /* 0 at prev, 1 at cur */
        float fade  = (1.0 - t / TRAIL_DURATION);
        fade *= fade; /* quadratic */
        float trailAlpha = glow * along * fade * TRAIL_OPACITY;
        color += TRAIL_COLOR * trailAlpha;
    }

    /* clamp and output */
    fragColor = vec4(min(color, vec3(1.0)), base.a);
}
