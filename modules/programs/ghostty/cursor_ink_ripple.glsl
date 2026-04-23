/* cursor_ink_ripple.glsl -- large-move ink ripple for Ghostty
 * Triggers a long-lived ripple on large cursor jumps and distorts the screen
 * texture around the expanding rings. Typing-scale cursor motion is ignored. */

const float START_DELAY = 0.24;
const float DURATION = 1.0;
const float THRESHOLD_SCALE = 6.0;
const float THRESHOLD_MIN = 96.0;
const float RADIUS_SCALE = 0.10;
const float RADIUS_MIN = 48.0;
const float RING_WIDTH = 12.0;
const float DISTORTION_STRENGTH = 20.0;
const float RIPPLE_FREQUENCY = 0.185;
const float RIPPLE_SPEED = 18.0;

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

float easeOutCubic(float x) {
    float t = 1.0 - saturate(x);
    return 1.0 - t * t * t;
}

vec2 safeNormalize(vec2 v) {
    float len = length(v);
    if (len < 1e-4) return vec2(1.0, 0.0);
    return v / len;
}

float ringBand(float dist, float radius, float width) {
    return smoothstep(width, 0.0, abs(dist - radius));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec4 base = texture(iChannel0, uv);

    if (iFocus <= 0 || iCursorVisible.x <= 0.0) {
        fragColor = base;
        return;
    }

    float elapsed = iTime - iTimeCursorChange;
    if (elapsed < START_DELAY) {
        fragColor = base;
        return;
    }

    float activeElapsed = elapsed - START_DELAY;
    if (activeElapsed >= DURATION) {
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
    float rippleMinDistance = max(max(iCurrentCursor.z, iCurrentCursor.w) * THRESHOLD_SCALE, THRESHOLD_MIN);
    if (moveDistance < rippleMinDistance) {
        fragColor = base;
        return;
    }

    float life = saturate(activeElapsed / DURATION);
    float progress = easeOutCubic(life);
    float fade = 1.0 - life;
    fade *= fade;

    float maxRadius = max(moveDistance * RADIUS_SCALE, RADIUS_MIN);
    float radius = maxRadius * progress;

    vec2 fromCenter = fragCoord - curCenter;
    float dist = length(fromCenter);
    vec2 normal = safeNormalize(fromCenter);

    float primaryRing = ringBand(dist, radius, RING_WIDTH);
    float outerRing = ringBand(dist, radius * 1.27, RING_WIDTH * 1.22) * 0.72;
    float innerRing = ringBand(dist, radius * 0.68, RING_WIDTH * 1.08) * 0.55;

    float rippleField = primaryRing + outerRing + innerRing;
    float waveEnvelope =
        exp(-abs(dist - radius) * 0.060) +
        exp(-abs(dist - radius * 1.27) * 0.050) * 0.65 +
        exp(-abs(dist - radius * 0.68) * 0.070) * 0.45;
    float wave = sin(dist * RIPPLE_FREQUENCY - life * RIPPLE_SPEED);
    float displacementAmount = wave * waveEnvelope * DISTORTION_STRENGTH * fade;

    vec2 distortedUv = clamp(uv + normal * (displacementAmount / iResolution.xy), vec2(0.0), vec2(1.0));
    vec4 distorted = texture(iChannel0, distortedUv);

    float impact = smoothstep(0.22, 0.0, life) * exp(-dist * 0.020);

    vec3 inkTone = mix(iPalette[4], iPalette[5], 0.55);
    inkTone = mix(inkTone, iPalette[6], 0.30);
    inkTone = mix(inkTone, iForegroundColor, 0.18);

    float ringAlpha = rippleField * 0.28 * fade;
    float distortionAlpha = saturate(waveEnvelope * 0.95 * fade);
    vec3 color = mix(base.rgb, distorted.rgb, distortionAlpha);
    color = mix(color, inkTone, ringAlpha);
    color += inkTone * primaryRing * 0.18 * fade;
    color += inkTone * outerRing * 0.08 * fade;
    color -= impact * 0.12;

    fragColor = vec4(clamp(color, 0.0, 1.0), base.a);
}
