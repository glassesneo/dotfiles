import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createReplayTemporary, renderReplay } from "./utilities/subagent_replay.ts";
import { readSnapshot, runPaths } from "./utilities/subagent_store.ts";
import { isTerminalState, validateSubagentRuntimeConfig } from "./utilities/subagent_types.ts";

export async function runReplayViewer(configPath: string, runId: string): Promise<void> {
    const config = validateSubagentRuntimeConfig(JSON.parse(await readFile(configPath, "utf8"))); const paths = runPaths(config.stateRoot, runId);
    const initial = await readSnapshot(config.stateRoot, runId); const live = !isTerminalState(initial.status);
    const temporary = await createReplayTemporary(paths.directory, await renderReplay(config.stateRoot, runId));
    const less = config.runner.less ?? "less";
    const pager = spawn(less, live ? ["-R", "+F", temporary] : ["-R", temporary], { stdio: "inherit", env: { ...process.env, LESSSECURE: "1", LESSHISTFILE: "-" } });
    try {
        if (live) {
            while (pager.exitCode === null && pager.signalCode === null) {
                await delay(200); const snapshot = await readSnapshot(config.stateRoot, runId);
                await writeFile(temporary, await renderReplay(config.stateRoot, runId), { mode: 0o600 });
                if (isTerminalState(snapshot.status)) { pager.kill("SIGTERM"); break; }
            }
        }
        await new Promise<void>((resolve, reject) => { if (pager.exitCode !== null || pager.signalCode !== null) resolve(); else { pager.once("error", reject); pager.once("close", () => resolve()); } });
    } finally { if (pager.exitCode === null && pager.signalCode === null) pager.kill("SIGTERM"); await rm(temporary, { force: true }); }
}
const invokedPath = process.argv[1]; if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) { const [configPath, runId] = process.argv.slice(2); if (!configPath || !runId) { process.stderr.write("Usage: subagent_viewer.ts <config-path> <run-id>\n"); process.exitCode = 2; } else await runReplayViewer(configPath, runId); }
