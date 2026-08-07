import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import type { SubagentRuntimeConfig, TmuxAgentReference } from "../extensions_src/utilities/subagent_types.ts";
import type { SubagentChildBridgeDependencies } from "../extensions_src/subagent_child_bridge.ts";

export const nativeProfile = { id: "99999999-9999-4999-8999-999999999999", model: "provider/model", availability: ["top-level", "subagent"] as ("top-level" | "subagent")[], description: "Tester", allowAllTools: false, tools: ["read"], hiddenSkillOptIns: [], extensions: { subagent: { allowedTargets: [] } } };
export const nativeConfig = (root: string): SubagentRuntimeConfig => ({ schemaVersion: 8, stateRoot: root, tmux: "/tmux", returnParentCommand: "/return-parent", parentNavigationHint: "F12 U: parent · /parent", historyViewerExtension: "/history-viewer.ts", childExtensions: ["/profile.ts", "/bridge.ts"], harnesses: { pi: { adapter: "pi-native", command: "/pi" } }, maxDepth: 3, childExcludedTools: ["question"], natureHandleWords: ["Maple", "Cedar"] });
export const nativeTmux: TmuxAgentReference = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$2", sessionName: "pi-sa-test", windowId: "@2", paneId: "%2", windowName: "sa-test" };

const temporaryRoots = new Set<string>();
after(async () => {
    await Promise.all([...temporaryRoots].map(root => rm(root, { recursive: true, force: true })));
    temporaryRoots.clear();
});

export async function subagentTestRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), prefix));
    temporaryRoots.add(root);
    return root;
}

export function controlledBridgeScheduler() {
    let clock = 0;
    let callback: (() => void | Promise<void>) | undefined;
    const dependencies: SubagentChildBridgeDependencies = {
        now: () => clock,
        setInterval(next) { callback = next; return 1; },
        clearInterval() { callback = undefined; },
    };
    return {
        dependencies,
        advance(milliseconds = 0) { clock += milliseconds; },
        async tick() { assert.ok(callback); await callback(); },
    };
}
