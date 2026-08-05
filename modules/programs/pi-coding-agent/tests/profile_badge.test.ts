import assert from "node:assert/strict";
import test from "node:test";
import { profileIdentityText } from "../extensions_src/profile.ts";

void test("profile identity status distinguishes parents and nested subagents", () => {
    assert.equal(profileIdentityText("scout", {}), "PARENT · profile:scout");
    assert.equal(profileIdentityText("reviewer", { PI_SUBAGENT_AGENT_ID: "agent", PI_SUBAGENT_DEPTH: "2" }), "SUBAGENT d2 · profile:reviewer");
    assert.equal(profileIdentityText("tester", { PI_SUBAGENT_AGENT_ID: "agent", PI_SUBAGENT_DEPTH: "invalid" }), "SUBAGENT d0 · profile:tester");
});
