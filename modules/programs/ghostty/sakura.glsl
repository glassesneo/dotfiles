/* sakura.glsl — Ghostty custom shader
 *   Catppuccin Frappé sakura petals that scatter from cursor movement,
 *   drift laterally, wobble, and float downward with additive glow.
 *   Idle frames fall through to a single texture fetch.
 *
 *   Limitation: Ghostty exposes only current/previous cursor state plus
 *   cursor-change timing, so continuous movement delivers a convincing
 *   falling-petal trail approximation, not true persistent particles. */

/* ───── Tunables ───────────────────────────────────────────────────────── */
const float DURATION       = 1.8;    /* seconds each burst lives          */
const int   NUM_PETALS     = 24;     /* petals per burst                  */
const float SCATTER_RADIUS = 80.0;   /* initial spread from cursor center */
const float FALL_SPEED     = 45.0;   /* downward drift px/s               */
const float DRIFT_SPEED    = 30.0;   /* lateral drift px/s                */
const float WOBBLE_AMP     = 12.0;   /* lateral wobble amplitude px       */
const float WOBBLE_FREQ    = 3.5;    /* wobble cycles per second          */
const float PETAL_RADIUS   = 5.0;    /* petal disc radius px              */
const float GLOW_RADIUS    = 14.0;   /* soft glow outer radius px         */
const float GLOW_INTENSITY = 0.55;   /* additive glow strength            */
const float MOVE_THRESHOLD = 0.5;    /* ignore sub-pixel cursor jitter    */
/* ──────────────────────────────────────────────────────────────────────── */

/* ───── Catppuccin Frappé sakura palette ──────────────────────────────── */
const vec3 SAKURA_PALETTE[5] = vec3[5](
    vec3(0.953, 0.549, 0.659),   /* #f38ba8  pink / rosewater-ish       */
    vec3(0.922, 0.482, 0.682),   /* #eb7bb6  flamingo                   */
    vec3(0.792, 0.533, 0.776),   /* #ca87c6  mauve-ish                  */
    vec3(0.949, 0.698, 0.745),   /* #f2b2be  light rose                 */
    vec3(0.839, 0.620, 0.784),   /* #d69ec8  lavender-pink              */
);
/* ──────────────────────────────────────────────────────────────────────── */

/* Simple hash — deterministic pseudo-random from a single float seed */
float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv   = fragCoord / iResolution.xy;
    vec4 base = texture(iChannel0, uv);
    float t   = iTime - iTimeCursorChange;

    /* idle fast-path: burst expired → pure passthrough */
    if (t >= DURATION) {
        fragColor = base;
        return;
    }

    /* derive cursor centers from Ghostty's (-X, +Y, width, height) rects */
    vec2 curCenter  = vec2(iCurrentCursor.x  + iCurrentCursor.z  * 0.5,
                           iCurrentCursor.y  - iCurrentCursor.w  * 0.5);
    vec2 prevCenter = vec2(iPreviousCursor.x + iPreviousCursor.z * 0.5,
                           iPreviousCursor.y - iPreviousCursor.w * 0.5);

    /* sub-threshold guard: no real movement → passthrough */
    if (length(curCenter - prevCenter) < MOVE_THRESHOLD) {
        fragColor = base;
        return;
    }

    vec3 color = base.rgb;
    float seed = iTimeCursorChange * 127.1; /* unique seed per burst */

    for (int i = 0; i < NUM_PETALS; i++) {
        float fi = float(i);
        float h1 = hash(seed + fi * 13.37);
        float h2 = hash(seed + fi * 7.91 + 3.0);
        float h3 = hash(seed + fi * 23.17 + 7.0);
        float h4 = hash(seed + fi * 31.53 + 11.0);

        /* petal birth: scattered around cursor center */
        float angle  = h1 * 6.2831853;
        float radius = h2 * SCATTER_RADIUS;
        vec2 origin  = curCenter + vec2(cos(angle), sin(angle)) * radius;

        /* motion: fall down, drift sideways, wobble */
        float driftDir = (h3 > 0.5) ? 1.0 : -1.0;
        float wobble   = sin(t * WOBBLE_FREQ + fi * 1.7) * WOBBLE_AMP * smoothstep(0.0, 0.3, t);
        vec2 pos = origin
                 + vec2(driftDir * DRIFT_SPEED * t + wobble, -FALL_SPEED * t * (0.6 + 0.4 * h4));

        /* distance from this fragment to the petal center */
        float dist = length(fragCoord - pos);

        /* skip early if clearly outside glow range */
        if (dist > GLOW_RADIUS) continue;

        /* lifecycle fade: ramp in quickly, fade out over duration */
        float life = t / DURATION;
        float fade = 1.0 - life * life;

        /* scale petal down as it ages */
        float r = PETAL_RADIUS * (1.0 - 0.5 * life);

        /* petal core + soft glow */
        float core = smoothstep(r, r * 0.3, dist);
        float glow = smoothstep(GLOW_RADIUS, r, dist);
        float alpha = (core + glow * GLOW_INTENSITY) * fade;

        /* pick palette color per petal */
        vec3 petalColor = SAKURA_PALETTE[i % 5];

        /* additive blend */
        color += petalColor * alpha;

        /* first-hit early return: strongest petal wins for this fragment */
        if (core > 0.5) {
            fragColor = vec4(min(color, vec3(1.0)), base.a);
            return;
        }
    }

    /* clamp and output */
    fragColor = vec4(min(color, vec3(1.0)), base.a);
}
