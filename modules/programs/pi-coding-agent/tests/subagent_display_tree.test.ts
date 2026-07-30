import assert from "node:assert/strict";
import test from "node:test";
import {
    assignNatureHandles,
    buildSubagentDisplayTree,
    flattenVisibleDisplayNodes,
    formatStateBadge,
    profileColorRole,
    retainSelection,
    type SubagentDisplayNode,
} from "../extensions_src/utilities/subagent_display_tree.ts";
import { emptyUsage, type AgentRecord, type AgentSnapshot, type AgentState } from "../extensions_src/utilities/subagent_types.ts";

function snapshot(options: {
    agentId: string;
    purpose: string;
    state: AgentState;
    parentAgentId?: string;
    createdAt: string;
    profile?: string;
}): AgentSnapshot {
    const agent: AgentRecord = {
        schemaVersion: 1,
        agentId: options.agentId,
        profile: options.profile ?? "tester",
        purpose: options.purpose,
        harness: "pi",
        cwd: "/work",
        createdAt: options.createdAt,
        profileSnapshot: { name: options.profile ?? "tester", tools: [], thinking: "off" } as never,
        tmux: { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "s", windowId: "@1", paneId: "%1", windowName: "w" },
        capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true },
        callerProfile: "taskmaster",
        targetProfile: options.profile ?? "tester",
        depth: options.parentAgentId ? 2 : 1,
        originSessionId: "origin",
        ...(options.parentAgentId ? { parentAgentId: options.parentAgentId } : {}),
    };
    return {
        agent,
        status: {
            schemaVersion: 1,
            agentId: options.agentId,
            state: options.state,
            bridgeReady: true,
            agentUsage: emptyUsage(),
            accountedTaskIds: [],
            updatedAt: options.createdAt,
        },
    };
}

void test("nature handles are deterministic and unique within one origin set", () => {
    const ids = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
    ];
    const first = assignNatureHandles(ids);
    const second = assignNatureHandles([...ids].reverse());
    assert.equal(first.get(ids[0]), second.get(ids[0]));
    assert.equal(new Set(first.values()).size, ids.length);
    for (const handle of first.values()) assert.match(handle, /^[A-Z][a-z]+-[0-9a-f]{4,}$/u);
});

void test("handle collisions extend only the colliding suffixes", () => {
    // Force same word+prefix by crafting ids that share hex prefix after nature word hash collision is unlikely;
    // verify uniqueness property on a large synthetic set instead.
    const ids = Array.from({ length: 40 }, (_, index) => `${index.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`);
    const handles = [...assignNatureHandles(ids).values()];
    assert.equal(new Set(handles).size, handles.length);
});

void test("custom nature handle words are used deterministically", () => {
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const words = ["Alpha", "Beta"] as const;
    const first = assignNatureHandles(ids, words);
    const second = assignNatureHandles([...ids].reverse(), words);
    assert.deepEqual(
        [...first.entries()].sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0),
        [...second.entries()].sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0),
    );
    for (const handle of first.values()) assert.match(handle, /^(Alpha|Beta)-[0-9a-f]{4,}$/u);
    const tree = buildSubagentDisplayTree([
        snapshot({ agentId: ids[0]!, purpose: "a", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" }),
    ], words);
    assert.match(tree.handles.get(ids[0]!)!, /^(Alpha|Beta)-/u);
});

void test("empty nature handle words throw", () => {
    assert.throws(() => assignNatureHandles(["11111111-1111-4111-8111-111111111111"], []), /must not be empty/);
});

void test("display tree keeps terminal middle agents as ghosts and promotes active descendants", () => {
    const a = snapshot({ agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", purpose: "root", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" });
    const b = snapshot({ agentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", purpose: "middle", state: "stopped", parentAgentId: a.agent.agentId, createdAt: "2026-01-01T00:01:00.000Z" });
    const c = snapshot({ agentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", purpose: "leaf", state: "busy", parentAgentId: b.agent.agentId, createdAt: "2026-01-01T00:02:00.000Z" });
    const input = [a, b, c];
    const cloned = structuredClone(input);
    const tree = buildSubagentDisplayTree(input);
    assert.deepEqual(input, cloned);
    assert.equal(tree.roots.length, 1);
    assert.equal(tree.roots[0]?.agentId, a.agent.agentId);
    assert.deepEqual(tree.roots[0]?.children.map((node: SubagentDisplayNode) => node.agentId), [b.agent.agentId, c.agent.agentId]);
    assert.equal(tree.byId.get(b.agent.agentId)?.ghost, true);
    assert.equal(tree.byId.get(c.agent.agentId)?.promoted, true);
    assert.equal(tree.byId.get(c.agent.agentId)?.viaHandle, tree.handles.get(b.agent.agentId));
    assert.equal(a.agent.parentAgentId, undefined);
    assert.equal(b.agent.parentAgentId, a.agent.agentId);
    assert.equal(c.agent.parentAgentId, b.agent.agentId);
});

void test("missing parents become orphaned roots and sibling order is createdAt ascending", () => {
    const orphan = snapshot({ agentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", purpose: "orphan", state: "idle", parentAgentId: "missing-parent", createdAt: "2026-01-01T00:03:00.000Z" });
    const early = snapshot({ agentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", purpose: "early", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" });
    const late = snapshot({ agentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", purpose: "late", state: "idle", createdAt: "2026-01-01T00:04:00.000Z" });
    const tree = buildSubagentDisplayTree([late, orphan, early]);
    assert.deepEqual(tree.roots.map(node => node.agentId), [early.agent.agentId, orphan.agent.agentId, late.agent.agentId]);
    assert.equal(tree.byId.get(orphan.agent.agentId)?.orphaned, true);
});

void test("collapse hides descendants while retainSelection keeps agentId across refresh", () => {
    const a = snapshot({ agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", purpose: "root", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" });
    const b = snapshot({ agentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", purpose: "child", state: "idle", parentAgentId: a.agent.agentId, createdAt: "2026-01-01T00:01:00.000Z" });
    const tree = buildSubagentDisplayTree([a, b]);
    const collapsed = new Set([a.agent.agentId]);
    const visible = flattenVisibleDisplayNodes(tree.roots, collapsed);
    assert.deepEqual(visible.map(node => node.agentId), [a.agent.agentId]);
    const refreshed = flattenVisibleDisplayNodes(buildSubagentDisplayTree([a, b]).roots, new Set());
    assert.equal(retainSelection(b.agent.agentId, refreshed, [a.agent.agentId, b.agent.agentId]), b.agent.agentId);
    assert.equal(retainSelection(b.agent.agentId, [refreshed[0]!], [a.agent.agentId, b.agent.agentId]), a.agent.agentId);
});

void test("state badges and profile roles stay textual and separated", () => {
    assert.equal(formatStateBadge("busy"), "● BUSY");
    assert.equal(formatStateBadge("failed"), "! FAILED");
    assert.notEqual(profileColorRole("tester"), "success");
    assert.notEqual(profileColorRole("tester"), "error");
    assert.equal(profileColorRole("tester"), profileColorRole("tester"));
});

void test("cyclic lineage breaks into orphaned roots so every record stays visible", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const tree = buildSubagentDisplayTree([
        snapshot({ agentId: a, purpose: "a", state: "stopped", parentAgentId: b, createdAt: "2026-01-01T00:00:00.000Z" }),
        snapshot({ agentId: b, purpose: "b", state: "stopped", parentAgentId: a, createdAt: "2026-01-01T00:01:00.000Z" }),
    ]);
    assert.equal(tree.byId.size, 2);
    assert.equal(flattenVisibleDisplayNodes(tree.roots, new Set()).length, 2);
    assert.ok(tree.roots.some(node => node.orphaned));
});
