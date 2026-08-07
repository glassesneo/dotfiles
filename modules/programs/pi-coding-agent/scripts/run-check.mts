import { spawn } from "node:child_process";

const commands = ["typecheck", "lint", "test"] as const;

const results = await Promise.all(commands.map(command => new Promise<boolean>(resolve => {
    let settled = false;
    const child = spawn("npm", ["run", command], { stdio: "inherit", env: process.env });
    const finish = (success: boolean) => {
        if (settled) return;
        settled = true;
        resolve(success);
    };
    child.once("error", error => {
        console.error(`[check] npm run ${command} failed to start:`, error);
        finish(false);
    });
    child.once("exit", (code, signal) => {
        if (signal) console.error(`[check] npm run ${command} terminated by signal ${signal}`);
        finish(code === 0 && signal === null);
    });
})));

if (results.some(success => !success)) process.exitCode = 1;
