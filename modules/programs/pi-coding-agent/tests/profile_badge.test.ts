import assert from "node:assert/strict";
import test from "node:test";
import { profileIdentityText } from "../extensions_src/profile.ts";

void test("profile identity status projects synthetic profile and nesting state", () => {
    const parent = profileIdentityText("synthetic-parent", {});
    assert.match(parent, /synthetic-parent/);
    assert.match(parent, /parent/i);

    const child = profileIdentityText("synthetic-child", { PI_SUBAGENT_AGENT_ID: "agent", PI_SUBAGENT_DEPTH: "7" });
    assert.match(child, /synthetic-child/);
    assert.match(child, /7/);
    assert.match(child, /subagent/i);

    const invalidDepth = profileIdentityText("synthetic-invalid", { PI_SUBAGENT_AGENT_ID: "agent", PI_SUBAGENT_DEPTH: "invalid" });
    assert.match(invalidDepth, /synthetic-invalid/);
    assert.match(invalidDepth, /subagent/i);
    assert.match(invalidDepth, /(?<!\d)0(?!\d)/);
});
