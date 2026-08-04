import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSubagentSubmitTool } from "../extensions_src/subagent.ts";
import { runExternalWorker } from "../extensions_src/subagent_external_worker.ts";
import { CursorAcpDriver, type ExternalDriver } from "../extensions_src/utilities/subagent_cursor_acp.ts";
import { resolveHarnessAdapter } from "../extensions_src/utilities/subagent_harness.ts";
import { historyAvailability } from "../extensions_src/utilities/subagent_history.ts";
import { agentPaths, createTask, markAgentStopping, markBridgeReady, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot, requestTaskCancellation } from "../extensions_src/utilities/subagent_store.ts";
import type { AgentProfile } from "../extensions_src/utilities/profile_types.ts";
import type { SubagentRuntimeConfig, TmuxAgentReference } from "../extensions_src/utilities/subagent_types.ts";

const options = { mode: "agent", permissionPolicy: "allow-always", sandbox: "disabled", trustWorkspace: true, worktree: false };
const cursorProfile: AgentProfile = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", model: "cursor/cursor-grok-4.5-high", availability: ["subagent"], description: "Cursor implementation.", allowAllTools: false, tools: [], instructions: "Implement and report evidence.",
    extensions: { subagent: { allowedTargets: [], harness: "cursor-agent", harnessOptions: options } },
};
const config = (root: string): SubagentRuntimeConfig => ({
    schemaVersion: 7, stateRoot: root, tmux: "/tmux", historyViewerExtension: "/history.ts", childExtensions: [],
    harnesses: {
        pi: { adapter: "pi-native", command: "/pi" },
        "cursor-agent": { adapter: "cursor-acp", command: "/cursor-agent", workerCommand: "/node", workerEntrypoint: "/worker.ts" },
    },
    maxDepth: 3, childExcludedTools: [], natureHandleWords: ["Maple"],
});

void test("harness registry validates Cursor policy before producing a worker launch", () => {
    const runtime = config("/state");
    const resolved = resolveHarnessAdapter(runtime, "cursor-agent", cursorProfile);
    assert.equal(resolved.adapter.kind, "cursor-acp");
    assert.equal(resolved.adapter.capabilities.usage, false);
    assert.equal(resolved.adapter.capabilities.terminalHistory, false);
    const launch = resolved.adapter.launch(runtime, resolved.harness, { agentId: "id", agentDirectory: "/agent", profile: "cursor-implementer", profileSnapshot: cursorProfile, depth: 1, originSessionId: "origin", cwd: "/work" });
    assert.equal(launch.command, "/node");
    assert.deepEqual(launch.args, ["--experimental-strip-types", "/worker.ts"]);
    assert.match(launch.env.PI_SUBAGENT_EXTERNAL_CONFIG!, /cursor-grok-4\.5-high/);
    assert.throws(() => resolveHarnessAdapter(runtime, "cursor-agent", { ...cursorProfile, model: "openai/model" }), /cursor\/<model>/u);
    assert.throws(() => resolveHarnessAdapter(runtime, "cursor-agent", { ...cursorProfile, extensions: { subagent: { allowedTargets: [], harness: "cursor-agent", harnessOptions: { ...options, sandbox: "workspace" } } } }), /sandbox/u);
});

void test("Cursor ACP cold start readiness past 5000 ms succeeds within the harness deadline", async () => {
    const root = await mkdtemp(join(tmpdir(), "cursor-acp-cold-start-"));
    const stateRoot = join(root, "state");
    const configPath = join(root, "subagent.json");
    const profilePath = join(root, "agent-profiles.json");
    const runtime: SubagentRuntimeConfig = {
        ...config(stateRoot),
        harnesses: {
            pi: { adapter: "pi-native", command: "/pi" },
            "cursor-agent": {
                adapter: "cursor-acp",
                command: "/cursor-agent",
                workerCommand: "/node",
                workerEntrypoint: "/worker.ts",
                bridgeReadyTimeoutMs: 15000,
            },
        },
    };
    await writeFile(configPath, JSON.stringify(runtime));
    await writeFile(profilePath, JSON.stringify({
        schemaVersion: 4,
        defaultProfile: "operator",
        profileCycle: ["operator"],
        promptRoutes: {},
        profiles: {
            operator: {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                model: "provider/model",
                availability: ["top-level"],
                description: "Operator.",
                allowAllTools: false,
                tools: ["subagent_submit"],
                extensions: { subagent: { allowedTargets: ["cursor-implementer"], harness: "pi" } },
            },
            "cursor-implementer": cursorProfile,
        },
    }));
    let hubSession = false;
    const exec = async (_command: string, args: string[]) => {
        if (args.includes("display-message") && args.at(-1)?.includes("#{pid}\t#{session_id}")) {
            return { stdout: "10\t$1\tmain\t%1\t/dev/ttys001\n", stderr: "", code: 0 };
        }
        if (args.includes("display-message") && args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("has-session")) return hubSession ? { stdout: "", stderr: "", code: 0 } : { stdout: "", stderr: "missing", code: 1 };
        if (args.includes("new-session")) {
            hubSession = true;
            return { stdout: "$hub\t@2\t%2\n", stderr: "", code: 0 };
        }
        if (args.includes("list-panes")) return { stdout: "%2\t0\n", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    let clock = 0;
    let markedReady = false;
    const tool = createSubagentSubmitTool({
        configPath,
        profileConfigPath: profilePath,
        env: { TMUX: "/tmp/tmux,1,0" },
        exec,
        activeProfile: () => ({ name: "operator", facet: { allowedTargets: ["cursor-implementer"], harness: "pi" } }),
        now: () => clock,
        sleep: async () => {
            clock += 550;
            if (!markedReady && clock >= 5500) {
                const agents = await readdir(join(stateRoot, "agents"));
                assert.equal(agents.length, 1);
                await markBridgeReady(agentPaths(stateRoot, agents[0]!));
                markedReady = true;
            }
        },
    }, ["cursor-implementer"]);
    const ctx = {
        cwd: root,
        sessionManager: { getSessionId: () => "origin", getSessionFile: () => join(root, "session.jsonl") },
    } as unknown as ExtensionContext;
    const response = await tool.execute(
        "cold-start",
        { profile: "cursor-implementer", purpose: "Cursor ACP smoke", prompt: "Read package.json and report its name." },
        undefined,
        undefined,
        ctx,
    ) as { content: Array<{ text: string }> };
    const content = JSON.parse(response.content[0]!.text) as { agentId: string; taskId: string; agentState: string };
    assert.ok(markedReady);
    assert.ok(clock > 5000);
    assert.ok(clock < 15000);
    assert.equal(typeof content.agentId, "string");
    assert.equal(typeof content.taskId, "string");
    const snapshot = await readAgentSnapshot(stateRoot, content.agentId, content.taskId);
    assert.equal(snapshot.status.bridgeReady, true);
    assert.equal(snapshot.status.state, "busy");
    assert.equal(snapshot.task?.status.state, "created");
});

void test("Cursor ACP driver reuses one session, streams text, and selects allow-always", async () => {
    const root = await mkdtemp(join(tmpdir(), "cursor-acp-peer-"));
    const log = join(root, "requests.jsonl");
    const peer = join(root, "peer.mjs");
    await writeFile(peer, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const log=${JSON.stringify(log)}; let prompts=0;
const send=value=>process.stdout.write(JSON.stringify(value)+"\\n");
createInterface({input:process.stdin}).on("line",line=>{const m=JSON.parse(line); appendFileSync(log,JSON.stringify(m)+"\\n");
 if(m.method==="initialize") send({jsonrpc:"2.0",id:m.id,result:{protocolVersion:1,authMethods:[]}});
 else if(m.method==="session/new") send({jsonrpc:"2.0",id:m.id,result:{sessionId:"same-session"}});
 else if(m.method==="session/prompt"){prompts++; if(prompts===1) send({jsonrpc:"2.0",id:"permission",method:"session/request_permission",params:{options:[{optionId:"once",kind:"allow-once"},{optionId:"always",kind:"allow-always"}]}}); send({jsonrpc:"2.0",method:"session/update",params:{update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"answer-"+prompts}}}}); send({jsonrpc:"2.0",id:m.id,result:{stopReason:"end_turn"}});}
});
`);
    await chmod(peer, 0o700);
    const events: string[] = [];
    const driver = new CursorAcpDriver({ command: peer, cwd: root, model: "cursor-grok-4.5-high", permissionPolicy: "allow-always", event: event => events.push(`${event.type}:${event.text}`) });
    try {
        await driver.start();
        assert.equal((await driver.runTask("first")).output, "answer-1");
        assert.equal((await driver.runTask("second")).output, "answer-2");
    } finally { await driver.shutdown(); }
    const requests = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    assert.equal(requests.filter(request => request.method === "session/new").length, 1);
    assert.equal(requests.filter(request => request.method === "session/prompt").length, 2);
    assert.ok(requests.some(request => request.id === "permission" && JSON.stringify(request.result).includes("always")));
    assert.ok(events.some(event => event === "permission:selected always"));
});

void test("unsupported blocking ACP requests fail the turn even after end_turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "cursor-acp-blocking-"));
    const peer = join(root, "peer.mjs");
    await writeFile(peer, `#!/usr/bin/env node
import { createInterface } from "node:readline";
let promptId; const send=value=>process.stdout.write(JSON.stringify(value)+"\\n");
createInterface({input:process.stdin}).on("line",line=>{const m=JSON.parse(line);
 if(m.method==="initialize") send({jsonrpc:"2.0",id:m.id,result:{protocolVersion:1,authMethods:[]}});
 else if(m.method==="session/new") send({jsonrpc:"2.0",id:m.id,result:{sessionId:"session"}});
 else if(m.method==="session/prompt"){promptId=m.id; send({jsonrpc:"2.0",id:"blocking",method:"unknown/blocking",params:{}});}
 else if(m.id==="blocking"){send({jsonrpc:"2.0",id:promptId,result:{stopReason:"end_turn"}});}
});
`);
    await chmod(peer, 0o700);
    const driver = new CursorAcpDriver({ command: peer, cwd: root, model: "cursor-grok-4.5-high", permissionPolicy: "allow-always", event: () => {} });
    try { await driver.start(); await assert.rejects(driver.runTask("work"), /Unsupported blocking ACP request/u); }
    finally { await driver.shutdown(); }
});

void test("ACP malformed output, authentication rejection, and idle process death are observable", async () => {
    const root = await mkdtemp(join(tmpdir(), "cursor-acp-failures-"));
    const malformed = join(root, "malformed.mjs");
    await writeFile(malformed, `#!/usr/bin/env node\nprocess.stdin.once("data",()=>process.stdout.write("not-json\\n"));\n`);
    await chmod(malformed, 0o700);
    const malformedDriver = new CursorAcpDriver({ command: malformed, cwd: root, model: "cursor-grok-4.5-high", permissionPolicy: "allow-always", event: () => {} });
    await assert.rejects(malformedDriver.start(), /Malformed ACP JSON-RPC/u);
    await malformedDriver.shutdown();

    const rejected = join(root, "rejected.mjs");
    await writeFile(rejected, `#!/usr/bin/env node
import { createInterface } from "node:readline"; const send=value=>process.stdout.write(JSON.stringify(value)+"\\n");
createInterface({input:process.stdin}).on("line",line=>{const m=JSON.parse(line); if(m.method==="initialize") send({jsonrpc:"2.0",id:m.id,result:{protocolVersion:1,authMethods:[{id:"login"}]}}); else if(m.method==="authenticate") send({jsonrpc:"2.0",id:m.id,error:{code:-32000,message:"login rejected"}});});
`);
    await chmod(rejected, 0o700);
    const rejectedDriver = new CursorAcpDriver({ command: rejected, cwd: root, model: "cursor-grok-4.5-high", permissionPolicy: "allow-always", event: () => {} });
    await assert.rejects(rejectedDriver.start(), /login rejected/u);
    await rejectedDriver.shutdown();

    const dying = join(root, "dying.mjs");
    await writeFile(dying, `#!/usr/bin/env node
import { createInterface } from "node:readline"; const send=value=>process.stdout.write(JSON.stringify(value)+"\\n");
createInterface({input:process.stdin}).on("line",line=>{const m=JSON.parse(line); if(m.method==="initialize") send({jsonrpc:"2.0",id:m.id,result:{protocolVersion:1,authMethods:[]}}); else if(m.method==="session/new"){send({jsonrpc:"2.0",id:m.id,result:{sessionId:"session"}}); setTimeout(()=>process.exit(9),10);}});
`);
    await chmod(dying, 0o700);
    const dyingDriver = new CursorAcpDriver({ command: dying, cwd: root, model: "cursor-grok-4.5-high", permissionPolicy: "allow-always", event: () => {} });
    await dyingDriver.start();
    assert.match((await dyingDriver.waitForClose()).message, /exited.*9/u);
    assert.ok(dyingDriver.fatalError());
});

void test("external worker terminalizes an idle agent when its driver process dies", async () => {
    const root = await mkdtemp(join(tmpdir(), "external-worker-idle-death-"));
    const tmux: TmuxAgentReference = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "hub", windowId: "@1", paneId: "%1", windowName: "cursor" };
    const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: false, interactiveInterventions: false, terminalHistory: false };
    const prepared = await prepareAgent(root, { profile: "cursor-implementer", purpose: "idle", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, lineage: { callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" }, capabilities });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "cursor-implementer", purpose: "idle", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, tmux, capabilities, callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" });
    const fatal = new Error("ACP process exited (9)");
    const driver: ExternalDriver = { async start() {}, async runTask() { return { output: "", stopReason: "end_turn" }; }, async cancel() {}, async shutdown() {}, waitForClose: async () => fatal, fatalError: () => fatal };
    const worker = runExternalWorker({ PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_STATE_ROOT: root, PI_SUBAGENT_EXTERNAL_CONFIG: JSON.stringify({ adapter: "cursor-acp", command: "/cursor", cwd: root, model: "cursor-grok-4.5-high", profile: "cursor-implementer", instructions: "contract", permissionPolicy: "allow-always" }) }, { createDriver: () => driver, sleep: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5))) });
    await assert.rejects(worker, /exited/u);
    const snapshot = await readAgentSnapshot(root, prepared.agentId);
    assert.equal(snapshot.status.state, "failed");
    assert.match(snapshot.status.exitReason ?? "", /exited/u);
});

void test("external worker terminalizes the agent when its driver dies during a task", async () => {
    const root = await mkdtemp(join(tmpdir(), "external-worker-death-"));
    const tmux: TmuxAgentReference = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "hub", windowId: "@1", paneId: "%1", windowName: "cursor" };
    const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: false, interactiveInterventions: false, terminalHistory: false };
    const prepared = await prepareAgent(root, { profile: "cursor-implementer", purpose: "fatal", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, lineage: { callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" }, capabilities });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "cursor-implementer", purpose: "fatal", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, tmux, capabilities, callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" });
    const fatal = new Error("ACP process exited (9)");
    let died = false;
    const driver: ExternalDriver = { async start() {}, async runTask() { died = true; throw fatal; }, async cancel() {}, async shutdown() {}, waitForClose: () => new Promise(() => {}), fatalError: () => died ? fatal : undefined };
    const worker = runExternalWorker({ PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_STATE_ROOT: root, PI_SUBAGENT_EXTERNAL_CONFIG: JSON.stringify({ adapter: "cursor-acp", command: "/cursor", cwd: root, model: "cursor-grok-4.5-high", profile: "cursor-implementer", instructions: "contract", permissionPolicy: "allow-always" }) }, { createDriver: () => driver, sleep: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5))) });
    while (!(await readAgentSnapshot(root, prepared.agentId)).status.bridgeReady) await new Promise(resolve => setTimeout(resolve, 5));
    const task = await createTask(root, prepared.agentId, "fatal", "trigger death");
    await worker;
    const snapshot = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.task?.status.state, "failed");
    assert.match(snapshot.status.exitReason ?? "", /exited/u);
});

void test("external worker observes parent stopping during an active turn and cancels ACP", async () => {
    const root = await mkdtemp(join(tmpdir(), "external-worker-cancel-"));
    const tmux: TmuxAgentReference = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "hub", windowId: "@1", paneId: "%1", windowName: "cursor" };
    const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: false, interactiveInterventions: false, terminalHistory: false };
    const prepared = await prepareAgent(root, { profile: "cursor-implementer", purpose: "cancel", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, lineage: { callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" }, capabilities });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "cursor-implementer", purpose: "cancel", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, tmux, capabilities, callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" });
    let rejectTurn!: (error: Error) => void;
    let cancels = 0;
    const running = new Promise<never>((_resolve, reject) => { rejectTurn = reject; });
    const driver: ExternalDriver = { async start() {}, runTask: () => running, async cancel() { cancels += 1; rejectTurn(new Error("cancelled")); }, async shutdown() {}, waitForClose: () => new Promise(() => {}), fatalError: () => undefined };
    const worker = runExternalWorker({ PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_STATE_ROOT: root, PI_SUBAGENT_EXTERNAL_CONFIG: JSON.stringify({ adapter: "cursor-acp", command: "/cursor", cwd: root, model: "cursor-grok-4.5-high", profile: "cursor-implementer", instructions: "contract", permissionPolicy: "allow-always" }) }, { createDriver: () => driver, sleep: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5))) });
    while (!(await readAgentSnapshot(root, prepared.agentId)).status.bridgeReady) await new Promise(resolve => setTimeout(resolve, 5));
    const task = await createTask(root, prepared.agentId, "cancel", "long turn");
    while ((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).task?.status.state !== "running") await new Promise(resolve => setTimeout(resolve, 5));
    await markAgentStopping(prepared.paths);
    await worker;
    const snapshot = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
    assert.equal(cancels, 1);
    assert.equal(snapshot.status.state, "stopped");
    assert.equal(snapshot.task?.status.state, "stopped");
});

void test("external worker observes a direct terminal agent transition during a never-resolving task", async () => {
    const root = await mkdtemp(join(tmpdir(), "external-worker-direct-terminal-"));
    const tmux: TmuxAgentReference = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "hub", windowId: "@1", paneId: "%1", windowName: "cursor" };
    const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: false, interactiveInterventions: false, terminalHistory: false };
    const prepared = await prepareAgent(root, { profile: "cursor-implementer", purpose: "direct stop", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, lineage: { callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" }, capabilities });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "cursor-implementer", purpose: "direct stop", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, tmux, capabilities, callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" });
    let cancels = 0; let shutdowns = 0;
    const driver: ExternalDriver = { async start() {}, runTask: () => new Promise(() => {}), async cancel() { cancels += 1; }, async shutdown() { shutdowns += 1; }, waitForClose: () => new Promise(() => {}), fatalError: () => undefined };
    const worker = runExternalWorker({ PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_STATE_ROOT: root, PI_SUBAGENT_EXTERNAL_CONFIG: JSON.stringify({ adapter: "cursor-acp", command: "/cursor", cwd: root, model: "cursor-grok-4.5-high", profile: "cursor-implementer", instructions: "contract", permissionPolicy: "allow-always" }) }, { createDriver: () => driver, sleep: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5))) });
    while (!(await readAgentSnapshot(root, prepared.agentId)).status.bridgeReady) await new Promise(resolve => setTimeout(resolve, 5));
    const task = await createTask(root, prepared.agentId, "direct stop", "never resolves");
    while ((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).task?.status.state !== "running") await new Promise(resolve => setTimeout(resolve, 5));
    await patchAgentStatus(prepared.paths, { state: "stopped", exitReason: "direct terminal transition" });
    await worker;
    const snapshot = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
    assert.equal(snapshot.status.state, "stopped"); assert.equal(snapshot.task?.status.state, "stopped"); assert.equal(cancels, 1); assert.equal(shutdowns, 1);
});

void test("external worker preserves a directly failed agent and reason while stopping its active task", async () => {
    const root = await mkdtemp(join(tmpdir(), "external-worker-direct-failed-"));
    const tmux: TmuxAgentReference = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "hub", windowId: "@1", paneId: "%1", windowName: "cursor" };
    const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: false, interactiveInterventions: false, terminalHistory: false };
    const prepared = await prepareAgent(root, { profile: "cursor-implementer", purpose: "direct failure", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, lineage: { callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" }, capabilities });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "cursor-implementer", purpose: "direct failure", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, tmux, capabilities, callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" });
    let cancels = 0; let shutdowns = 0;
    const driver: ExternalDriver = { async start() {}, runTask: () => new Promise(() => {}), async cancel() { cancels += 1; }, async shutdown() { shutdowns += 1; }, waitForClose: () => new Promise(() => {}), fatalError: () => undefined };
    const worker = runExternalWorker({ PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_STATE_ROOT: root, PI_SUBAGENT_EXTERNAL_CONFIG: JSON.stringify({ adapter: "cursor-acp", command: "/cursor", cwd: root, model: "cursor-grok-4.5-high", profile: "cursor-implementer", instructions: "contract", permissionPolicy: "allow-always" }) }, { createDriver: () => driver, sleep: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5))) });
    while (!(await readAgentSnapshot(root, prepared.agentId)).status.bridgeReady) await new Promise(resolve => setTimeout(resolve, 5));
    const task = await createTask(root, prepared.agentId, "direct failure", "never resolves");
    while ((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).task?.status.state !== "running") await new Promise(resolve => setTimeout(resolve, 5));
    await patchAgentStatus(prepared.paths, { state: "failed", exitReason: "parent-owned failure" });
    await worker;
    const snapshot = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
    assert.equal(snapshot.status.state, "failed"); assert.equal(snapshot.status.exitReason, "parent-owned failure"); assert.equal(snapshot.task?.status.state, "failed"); assert.equal(snapshot.task?.result?.error, "parent-owned failure"); assert.equal(cancels, 1); assert.equal(shutdowns, 1);
});

void test("external worker races a never-resolving active task with driver close", async () => {
    const root = await mkdtemp(join(tmpdir(), "external-worker-close-race-"));
    const tmux: TmuxAgentReference = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "hub", windowId: "@1", paneId: "%1", windowName: "cursor" };
    const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: false, interactiveInterventions: false, terminalHistory: false };
    const prepared = await prepareAgent(root, { profile: "cursor-implementer", purpose: "driver close", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, lineage: { callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" }, capabilities });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "cursor-implementer", purpose: "driver close", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, tmux, capabilities, callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" });
    let close!: (error: Error) => void; let didClose = false; const closed = new Promise<Error>(resolve => { close = error => { didClose = true; resolve(error); }; });
    const driver: ExternalDriver = { async start() {}, runTask: () => new Promise(() => {}), async cancel() {}, async shutdown() {}, waitForClose: () => closed, fatalError: () => didClose ? new Error("ACP driver closed") : undefined };
    const worker = runExternalWorker({ PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_STATE_ROOT: root, PI_SUBAGENT_EXTERNAL_CONFIG: JSON.stringify({ adapter: "cursor-acp", command: "/cursor", cwd: root, model: "cursor-grok-4.5-high", profile: "cursor-implementer", instructions: "contract", permissionPolicy: "allow-always" }) }, { createDriver: () => driver, sleep: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5))) });
    while (!(await readAgentSnapshot(root, prepared.agentId)).status.bridgeReady) await new Promise(resolve => setTimeout(resolve, 5));
    const task = await createTask(root, prepared.agentId, "driver close", "never resolves");
    while ((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).task?.status.state !== "running") await new Promise(resolve => setTimeout(resolve, 5));
    close(new Error("ACP process closed during task")); await worker;
    const snapshot = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
    assert.equal(snapshot.status.state, "failed"); assert.equal(snapshot.task?.status.state, "failed"); assert.match(snapshot.status.exitReason ?? "", /closed during task/u);
});

void test("external task cancellation waits for ACP settlement, preserves partial output, and then reuses the driver", async () => {
    const root = await mkdtemp(join(tmpdir(), "external-worker-task-cancel-"));
    const tmux: TmuxAgentReference = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "hub", windowId: "@1", paneId: "%1", windowName: "cursor" };
    const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: false, interactiveInterventions: false, terminalHistory: false };
    const prepared = await prepareAgent(root, { profile: "cursor-implementer", purpose: "first", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, lineage: { callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" }, capabilities });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "cursor-implementer", purpose: "first", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, tmux, capabilities, callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" });
    let rejectFirst!: (error: Error) => void;
    const firstTurn = new Promise<never>((_resolve, reject) => { rejectFirst = reject; });
    let calls = 0;
    let cancels = 0;
    const driver: ExternalDriver = {
        async start() {},
        async runTask() { calls += 1; if (calls === 1) return firstTurn; return { output: "second done", stopReason: "end_turn" }; },
        async cancel() { cancels += 1; },
        partialOutput: () => "partial before cancel",
        async shutdown() {},
        waitForClose: () => new Promise(() => {}),
        fatalError: () => undefined,
    };
    const worker = runExternalWorker({ PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_STATE_ROOT: root, PI_SUBAGENT_EXTERNAL_CONFIG: JSON.stringify({ adapter: "cursor-acp", command: "/cursor", cwd: root, model: "cursor-grok-4.5-high", profile: "cursor-implementer", instructions: "contract", permissionPolicy: "allow-always" }) }, { createDriver: () => driver, sleep: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5))) });
    while (!(await readAgentSnapshot(root, prepared.agentId)).status.bridgeReady) await new Promise(resolve => setTimeout(resolve, 5));
    const first = await createTask(root, prepared.agentId, "first", "long turn");
    while ((await readAgentSnapshot(root, prepared.agentId, first.request.taskId)).task?.status.state !== "running") await new Promise(resolve => setTimeout(resolve, 5));
    await requestTaskCancellation(root, prepared.agentId, first.request.taskId, "cancel first");
    while (cancels === 0) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await readAgentSnapshot(root, prepared.agentId, first.request.taskId)).task?.status.state, "running");
    assert.equal(calls, 1);
    rejectFirst(new Error("cancelled by ACP"));
    while ((await readAgentSnapshot(root, prepared.agentId, first.request.taskId)).task?.status.state !== "stopped") await new Promise(resolve => setTimeout(resolve, 5));
    const stopped = await readAgentSnapshot(root, prepared.agentId, first.request.taskId);
    assert.equal(stopped.task?.result?.output, "partial before cancel");
    const second = await createTask(root, prepared.agentId, "second", "reuse");
    while ((await readAgentSnapshot(root, prepared.agentId, second.request.taskId)).task?.status.state !== "succeeded") await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls, 2);
    await markAgentStopping(prepared.paths);
    await worker;
});

void test("external worker persists two sequential tasks through one driver instance", async () => {
    const root = await mkdtemp(join(tmpdir(), "external-worker-"));
    const tmux: TmuxAgentReference = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "hub", windowId: "@1", paneId: "%1", windowName: "cursor" };
    const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: false, interactiveInterventions: false, terminalHistory: false };
    const prepared = await prepareAgent(root, { profile: "cursor-implementer", purpose: "first", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, lineage: { callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" }, capabilities });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "cursor-implementer", purpose: "first", harness: "cursor-agent", cwd: root, profileSnapshot: cursorProfile, tmux, capabilities, callerProfile: "operator", targetProfile: "cursor-implementer", depth: 1, originSessionId: "origin" });
    const prompts: string[] = [];
    const driver: ExternalDriver = { async start() {}, async runTask(prompt) { prompts.push(prompt); return { output: `done-${prompts.length}`, stopReason: "end_turn" }; }, async cancel() {}, async shutdown() {}, waitForClose: () => new Promise(() => {}), fatalError: () => undefined };
    const worker = runExternalWorker({ PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_STATE_ROOT: root, PI_SUBAGENT_EXTERNAL_CONFIG: JSON.stringify({ adapter: "cursor-acp", command: "/cursor", cwd: root, model: "cursor-grok-4.5-high", profile: "cursor-implementer", instructions: "contract", permissionPolicy: "allow-always" }) }, { createDriver: () => driver, sleep: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5))) });
    while (!(await readAgentSnapshot(root, prepared.agentId)).status.bridgeReady) await new Promise(resolve => setTimeout(resolve, 5));
    const first = await createTask(root, prepared.agentId, "first", "change one");
    while ((await readAgentSnapshot(root, prepared.agentId, first.request.taskId)).task?.status.state !== "succeeded") await new Promise(resolve => setTimeout(resolve, 5));
    const second = await createTask(root, prepared.agentId, "second", "remediate");
    while ((await readAgentSnapshot(root, prepared.agentId, second.request.taskId)).task?.status.state !== "succeeded") await new Promise(resolve => setTimeout(resolve, 5));
    await markAgentStopping(prepared.paths);
    await worker;
    const stopped = await readAgentSnapshot(root, prepared.agentId, second.request.taskId);
    assert.equal(stopped.status.state, "stopped");
    assert.deepEqual(historyAvailability(stopped), { available: false, reason: "history unavailable for cursor-agent harness" });
    assert.deepEqual(prompts, ["contract\n\nDelegated task:\nchange one", "contract\n\nDelegated task:\nremediate"]);
});
