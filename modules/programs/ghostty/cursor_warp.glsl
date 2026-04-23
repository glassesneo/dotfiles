/* cursor_warp.glsl -- Neovide-inspired Ghostty cursor trail
 * Draws a softened stretched trail between the previous and current cursor. */

const float DURATION = 0.16;
const float MIN_DISTANCE = 0.75;
const float WARP_MIN_DISTANCE = 14.0;
const float SOFTNESS = 1.25;
const float GLOW = 4.0;
const float TRAIL_OPACITY = 0.75;
const float HEAD_OPACITY = 0.35;

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

float easeOutCubic(float x) {
    float t = 1.0 - saturate(x);
    return 1.0 - t * t * t;
}

float sdSegment(vec2 p, vec2 a, vec2 b, out float along) {
    vec2 ab = b - a;
    float denom = max(dot(ab, ab), 1e-4);
    along = saturate(dot(p - a, ab) / denom);
    vec2 closest = mix(a, b, along);
    return length(p - closest);
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

    vec2 delta = curCenter - prevCenter;
    float distancePx = length(delta);
    if (distancePx < MIN_DISTANCE) {
        fragColor = base;
        return;
    }

    if (distancePx < WARP_MIN_DISTANCE) {
        fragColor = base;
        return;
    }

    float life = saturate(elapsed / DURATION);
    float progress = easeOutCubic(life);
    float fade = 1.0 - life;
    fade *= fade;

    vec2 trailHead = mix(prevCenter, curCenter, progress);
    float cursorRadius = max(max(iCurrentCursor.z, iCurrentCursor.w), 1.0) * 0.5;
    float trailHalfWidth = max(cursorRadius * 0.72, 1.0);

    float along = 0.0;
    float distToTrail = sdSegment(fragCoord, prevCenter, trailHead, along);
    float taper = mix(0.55, 1.0, along);
    float body = smoothstep(trailHalfWidth * taper + SOFTNESS, trailHalfWidth * taper - SOFTNESS, distToTrail);
    float glow = smoothstep(trailHalfWidth * taper + GLOW, trailHalfWidth * taper, distToTrail);

    float headDist = length(fragCoord - curCenter);
    float head = smoothstep(cursorRadius + GLOW, cursorRadius * 0.4, headDist);

    vec3 trailColor = mix(iCursorColor, iForegroundColor, 0.18);
    vec3 color = base.rgb;
    color += trailColor * body * TRAIL_OPACITY * fade;
    color += trailColor * glow * 0.22 * fade;
    color += iCursorColor * head * HEAD_OPACITY * fade;

    fragColor = vec4(min(color, vec3(1.0)), base.a);
}
