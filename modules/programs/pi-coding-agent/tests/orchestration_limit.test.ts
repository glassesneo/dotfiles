import assert from "node:assert/strict";
import test from "node:test";
import { classifyInvocationFailure, hasRecoverableLimit } from "../extensions_src/utilities/orchestration_limit.ts";

void test("classifies known usage limits and refuses ambiguous quota strings", () => {
    const limit = classifyInvocationFailure({ code: "usage_limit_reached", now: () => "2026-01-01T00:00:00.000Z" });
    assert.equal(limit.class, "limit");
    assert.equal(limit.resumeEligible, true);
    const chatgpt = classifyInvocationFailure({ errorMessage: "You have hit your ChatGPT usage limit. Try again later." });
    assert.equal(chatgpt.class, "limit");
    assert.equal(classifyInvocationFailure({ httpStatus: 429 }).class, "other");
    assert.equal(classifyInvocationFailure({ errorMessage: "rate limit exceeded" }).class, "other");
    assert.equal(classifyInvocationFailure({ errorMessage: "context length" }).class, "other");
    assert.equal(classifyInvocationFailure({ transportBroken: true }).class, "transport");
    assert.equal(classifyInvocationFailure({ jsonRpcCode: -32001, jsonRpcData: { code: "usage_limit_reached" } }).class, "limit");
    assert.equal(classifyInvocationFailure({ jsonRpcCode: -32000 }).class, "protocol");
    assert.equal(hasRecoverableLimit([limit, classifyInvocationFailure({ errorMessage: "boom" })]), true);
    assert.equal(hasRecoverableLimit([classifyInvocationFailure({ errorMessage: "boom" })]), false);
});
