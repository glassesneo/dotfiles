import assert from "node:assert/strict";
import test from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
    COMMAND_PALETTE_DISCOVER_EVENT,
    COMMAND_PALETTE_REGISTER_EVENT,
    CommandPaletteContributionRegistry,
    provideCommandPaletteContribution,
} from "../extensions_src/utilities/command_palette_contributions.ts";

void test("contributions replace by stable owner/id and sort independently of registration order", () => {
    const registry = new CommandPaletteContributionRegistry(["model"]);
    assert.equal(registry.register({ owner: "z", id: "run", label: "Zulu", description: "z", run() {} }), true);
    assert.equal(registry.register({ owner: "a", id: "run", label: "Alpha", description: "a", run() {} }), true);
    assert.equal(registry.register({ owner: "z", id: "run", label: "Beta", description: "replacement", run() {} }), true);
    assert.deepEqual(registry.list().map(item => `${item.owner}:${item.id}:${item.label}`), ["a:run:Alpha", "z:run:Beta"]);
    assert.equal(registry.register({ owner: "provider", id: "model", label: "Reserved", description: "bad", run() {} }), false);
    assert.equal(registry.list().length, 2);
});

void test("provider registration and discovery handshake are idempotent across load order", () => {
    const bus = createEventBus();
    const registry = new CommandPaletteContributionRegistry();
    const unloadStaleProvider = provideCommandPaletteContribution(bus, { owner: "subagent", id: "runs", label: "Stale Subagents", description: "Runs", run() {} });
    bus.on(COMMAND_PALETTE_REGISTER_EVENT, value => registry.register(value));
    bus.emit(COMMAND_PALETTE_DISCOVER_EVENT, undefined);
    unloadStaleProvider();
    provideCommandPaletteContribution(bus, { owner: "subagent", id: "runs", label: "Subagents", description: "Reloaded runs", run() {} });
    bus.emit(COMMAND_PALETTE_DISCOVER_EVENT, undefined);
    assert.deepEqual(registry.list().map(item => [item.label, item.description]), [["Subagents", "Reloaded runs"]]);
});

void test("malformed contribution payloads are ignored without executing handlers", () => {
    const registry = new CommandPaletteContributionRegistry();
    for (const value of [null, {}, { owner: "Bad Owner", id: "x", label: "X", description: "x", run() {} }, { owner: "x", id: "x", label: "", description: "x", run() {} }]) {
        assert.equal(registry.register(value), false);
    }
    assert.equal(registry.invalidCount, 4);
    assert.deepEqual(registry.list(), []);
});
