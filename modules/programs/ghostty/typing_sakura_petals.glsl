/* typing_sakura_petals.glsl -- cursor-centered sakura petals on typing
 * Emits a small burst of drifting, rotating petals when cursor changes look like typing. */

const float DURATION = 0.74;
const int PETAL_COUNT = 5;
const float MIN_DISTANCE = 0.15;
const float MAX_TYPING_DISTANCE = 42.0;
const float BASE_SPEED = 22.0;
const float SPEED_RAND = 34.0;
const float FORWARD_BIAS = 16.0;
const float GRAVITY = 20.0;
const float DRIFT = 18.0;
const float SPAWN_SCATTER = 6.2;
const float EARLY_BURST = 0.72;
const float OPACITY = 0.58;

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

vec2 rotate2d(vec2 v, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c) * v;
}

vec2 safeNormalize(vec2 v) {
    float len = length(v);
    if (len < 1e-4) return vec2(1.0, 0.0);
    return v / len;
}

float easeOutCubic(float x) {
    float t = 1.0 - saturate(x);
    return 1.0 - t * t * t;
}

vec3 petalColor(float n) {
    float slot = floor(hash(n) * 5.0);
    if (slot < 1.0) return vec3(1.00, 0.93, 0.96);
    if (slot < 2.0) return vec3(0.99, 0.82, 0.89);
    if (slot < 3.0) return vec3(0.97, 0.72, 0.84);
    if (slot < 4.0) return vec3(0.94, 0.60, 0.78);
    return vec3(0.90, 0.49, 0.70);
}

float petalField(vec2 p) {
    float y = clamp(p.y, -1.2, 1.2);
    float midWidth = 0.82 * (1.0 - pow(abs(y + 0.02), 1.55));
    float lowerTaper = mix(0.16, 1.0, smoothstep(-1.05, -0.15, y));
    float upperTaper = mix(1.0, 0.38, smoothstep(0.10, 1.00, y));
    float width = max(midWidth * lowerTaper * upperTaper, 0.0);
    float notch = 0.18 * exp(-16.0 * p.x * p.x) * smoothstep(0.30, 1.00, y);
    width -= notch;

    float side = width - abs(p.x);
    float bottom = y + 1.02;
    float top = 1.02 - y;
    return min(min(side, bottom), top);
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
    typingBias = mix(0.45, 1.0, typingBias);

    vec3 color = base.rgb;
    vec2 moveDir = safeNormalize(curCenter - prevCenter);
    float seed = iTimeCursorChange * 173.31;
    float travel = mix(life, easeOutCubic(life), EARLY_BURST);
    float appear = smoothstep(0.03, 0.12, life);
    float cursorDeadZone = max(max(iCurrentCursor.z, iCurrentCursor.w) * 0.45, 4.0);
    float deadZoneMask = smoothstep(cursorDeadZone - 1.0, cursorDeadZone + 2.5, length(fragCoord - curCenter));

    for (int i = 0; i < PETAL_COUNT; ++i) {
        float fi = float(i);
        float angle = hash(seed + fi * 11.3) * 4.2 - 2.1;
        vec2 launchDir = rotate2d(moveDir, angle);
        vec2 sideDir = vec2(-launchDir.y, launchDir.x);
        float speed = BASE_SPEED + hash(seed + fi * 5.7) * SPEED_RAND;
        float forward = hash(seed + fi * 13.1) * FORWARD_BIAS * typingBias;
        float driftPhase = hash(seed + fi * 17.9) * 6.2831853;
        float drift = sin(life * 4.4 + driftPhase) * DRIFT * (0.45 + hash(seed + fi * 3.2));
        float gravity = GRAVITY + hash(seed + fi * 7.1) * 18.0;
        float scatterForward = (0.28 + hash(seed + fi * 41.3) * 0.92) * SPAWN_SCATTER;
        float scatterSide = (hash(seed + fi * 43.7) * 2.0 - 1.0) * SPAWN_SCATTER * 0.90;
        vec2 spawnOffset = launchDir * scatterForward + sideDir * scatterSide;

        vec2 petalCenter = curCenter
            + spawnOffset
            + launchDir * speed * travel
            + moveDir * forward * travel;
        petalCenter.x += drift * travel;
        petalCenter.y -= gravity * life * life;

        float widthPx = 7.4 + hash(seed + fi * 19.7) * 4.8;
        float heightPx = widthPx * (2.15 + hash(seed + fi * 23.3) * 0.75);
        float baseRotation = hash(seed + fi * 29.1) * 6.2831853;
        float spin = (hash(seed + fi * 31.7) * 2.0 - 1.0) * 1.8;
        float wobble = sin(life * 6.2 + driftPhase) * 0.34;
        float rotation = baseRotation + spin * life + wobble;

        vec2 local = rotate2d(fragCoord - petalCenter, -rotation) / vec2(widthPx, heightPx);
        float field = petalField(local);
        float mask = smoothstep(-0.08, 0.04, field);
        if (mask <= 0.001) continue;

        float edge = smoothstep(0.18, -0.02, abs(field));
        float centerVein = exp(-28.0 * local.x * local.x) * smoothstep(-0.85, 0.95, local.y);
        vec3 fill = petalColor(seed + fi * 37.0);
        fill = mix(fill, vec3(0.99, 0.88, 0.93), centerVein * 0.20 + edge * 0.07);

        float alpha = mask * fade * appear * deadZoneMask * OPACITY * typingBias;
        color = mix(color, fill, alpha);
        color += fill * edge * alpha * 0.06;
    }

    fragColor = vec4(min(color, vec3(1.0)), base.a);
}
