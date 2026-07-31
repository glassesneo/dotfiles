import assert from "node:assert/strict";
import test from "node:test";

import createMcpServer from "./dist/server.js";
import webParams from "./dist/tools/web/params.js";

void test("built server exposes the MCP lifecycle surface", async () => {
    const server = createMcpServer();
    assert.equal(typeof server.connect, "function");
    assert.equal(typeof server.close, "function");
    await server.close();
});

void test("built web-search schema enforces the query boundary", () => {
    assert.equal(webParams.parse({ query: "nix flakes" }).query, "nix flakes");
    assert.equal(webParams.safeParse({ query: "x".repeat(401) }).success, false);
    assert.equal(webParams.safeParse({ query: Array.from({ length: 51 }, () => "word").join(" ") }).success, false);
});
