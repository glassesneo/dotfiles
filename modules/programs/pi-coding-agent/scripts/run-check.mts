import { spawn } from "node:child_process";

const fullCommands = ["typecheck", "lint", "test"] as const;
const orchestrationCommands = ["typecheck", "lint:orchestration", "test:orchestration"] as const;

export interface CheckChild {
    once(event: "error", listener: (error: Error) => void): unknown;
    once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type CheckSpawner = (command: string, args: readonly string[], options: { stdio: "inherit"; env: NodeJS.ProcessEnv }) => CheckChild;

function selectCommands(args: readonly string[]): readonly string[] {
    if (args.length === 0) return fullCommands;
    if (args.length === 1 && args[0] === "orchestration") return orchestrationCommands;
    throw new Error(`Unknown check scope: ${args.join(" ") || "(empty)"}`);
}

export async function runCheck(args: readonly string[], spawnProcess: CheckSpawner = spawn): Promise<boolean> {
    const commands = selectCommands(args);
    const results = await Promise.all(commands.map(command => new Promise<boolean>(resolve => {
        let settled = false;
        const child = spawnProcess("pnpm", ["run", command], { stdio: "inherit", env: process.env });
        const finish = (success: boolean) => {
            if (settled) return;
            settled = true;
            resolve(success);
        };
        child.once("error", error => {
            console.error(`[check] pnpm run ${command} failed to start:`, error);
            finish(false);
        });
        child.once("exit", (code, signal) => {
            if (signal) console.error(`[check] pnpm run ${command} terminated by signal ${signal}`);
            finish(code === 0 && signal === null);
        });
    })));
    return !results.some(success => !success);
}

if (import.meta.main) {
    try {
        if (!await runCheck(process.argv.slice(2))) process.exitCode = 1;
    } catch (error) {
        console.error(`[check] ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}
