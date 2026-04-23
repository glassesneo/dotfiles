/* typing_micro_sparks.glsl -- palette-aware cursor explosion
 * Replaces the local spark cloud with a short-lived radial burst from the cursor. */

const float DURATION = 0.30;
const int SPARK_COUNT = 10;
const float MIN_DISTANCE = 0.15;
const float MAX_TYPING_DISTANCE = 42.0;
const float BASE_SPEED = 38.0;
const float SPEED_RAND = 92.0;
const float BASE_RADIUS = 3.5;
const float SIZE_RAND = 5.0;
const float GRAVITY = 62.0;
const float FORWARD_BIAS = 14.0;
const float OPACITY = 0.55;

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

vec3 accentColor(float n) {
    float slot = floor(hash(n) * 6.0);
    if (slot < 1.0) return iPalette[1];
    if (slot < 2.0) return iPalette[2];
    if (slot < 3.0) return iPalette[3];
    if (slot < 4.0) return iPalette[4];
    if (slot < 5.0) return iPalette[5];
    return iPalette[6];
}

vec2 safeNormalize(vec2 v) {
    float len = length(v);
    if (len < 1e-4) return vec2(1.0, 0.0);
    return v / len;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec4 base = texture(iChannel0, uv);

    if (iFocus <= 0 || iCursorVisible.x <= 0.0) {
        fragColor = base;
        return;
    }

    float elapsed = iTime - iTimeCursorChange;
    if (elapsed >= DURATION) {
        fragColor = base;
        return;
    }

    vec2 prevCenter = vec2(
        iPreviousCursor.x + iPreviousCursor.z * 0.5,
        iPreviousCursor.y - iPreviousCursor.w * 0.5
    );
    vec2 curCenter = vec2(
        iCurrentCursor.x + iCurrentCursor.z * 0.5,
        iCurrentCursor.y - iCurrentCursor.w * 0.5
    );

    float moveDistance = length(curCenter - prevCenter);
    if (moveDistance < MIN_DISTANCE || moveDistance > MAX_TYPING_DISTANCE) {
        fragColor = base;
        return;
    }

    float life = saturate(elapsed / DURATION);
    float fade = 1.0 - life;
    fade *= fade;

    float typingBias = 1.0 - saturate((moveDistance - 1.0) / max(MAX_TYPING_DISTANCE - 1.0, 1.0));
    typingBias = mix(0.35, 1.0, typingBias);

    vec3 color = base.rgb;
    vec2 moveDir = safeNormalize(curCenter - prevCenter);

    float seed = iTimeCursorChange * 211.7;
    float progress = life;
    for (int i = 0; i < SPARK_COUNT; ++i) {
        float fi = float(i);
        float angle = hash(seed + fi * 17.0) * 6.2831853;
        vec2 particleDir = vec2(cos(angle), sin(angle));
        float speed = BASE_SPEED + hash(seed + fi * 5.3) * SPEED_RAND;
        float lift = GRAVITY + hash(seed + fi * 7.7) * 70.0;
        float forward = hash(seed + fi * 11.1) * FORWARD_BIAS * typingBias;
        vec2 sparkCenter = curCenter
            + particleDir * speed * progress
            + moveDir * forward * progress;
        sparkCenter.y -= lift * progress * progress;

        float sparkRadius = (BASE_RADIUS + hash(seed + fi * 9.1) * SIZE_RAND) * mix(1.0, 0.45, progress);
        float dist = length(fragCoord - sparkCenter);
        float core = smoothstep(sparkRadius + 1.2, sparkRadius * 0.22, dist);
        float halo = smoothstep(sparkRadius * 3.0, sparkRadius * 0.65, dist);

        vec3 sparkColor = accentColor(seed + fi * 13.0);
        float alpha = (core + halo * 0.30) * fade * OPACITY * typingBias;
        color += sparkColor * alpha;
    }

    fragColor = vec4(min(color, vec3(1.0)), base.a);
}
