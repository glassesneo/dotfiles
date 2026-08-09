import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexAcpDriver } from "../extensions_src/utilities/orchestration_codex_acp.ts";
import { eventually } from "./test_helpers.ts";

const peer = `#!/usr/bin/env node
const fs=require("fs"); const readline=require("readline");
const record=m=>fs.appendFileSync(process.cwd()+"/requests.jsonl",JSON.stringify(m)+"\\n");
const send=m=>process.stdout.write(JSON.stringify(m)+"\\n");
const scenario=fs.readFileSync(process.cwd()+"/scenario","utf8").trim();
let promptId; const input=readline.createInterface({input:process.stdin});
input.on("line",line=>{const message=JSON.parse(line); record(message);
 if(message.method==="initialize"){
  fs.writeFileSync(process.cwd()+"/environment.json",JSON.stringify({mode:process.env.INITIAL_AGENT_MODE,noBrowser:process.env.NO_BROWSER,config:JSON.parse(process.env.CODEX_CONFIG)}));
  if(scenario==="auth") send({jsonrpc:"2.0",id:message.id,error:{code:-32000,message:"authentication required"}});
  else send({jsonrpc:"2.0",id:message.id,result:{protocolVersion:scenario==="protocol"?2:1}});
 } else if(message.method==="session/new"){
  const mode=scenario==="mode"?"agent":"read-only"; const model=scenario==="model"?"gpt-other":"gpt-5.6-luna";
  send({jsonrpc:"2.0",id:message.id,result:{sessionId:"session-1",modes:{availableModes:[{id:mode}]},configOptions:[{id:"model",options:[{value:model}]}]}});
 } else if(message.method==="session/set_mode") send({jsonrpc:"2.0",id:message.id,result:{}});
 else if(message.method==="session/set_config_option"){
  const effort=scenario==="effort"?"medium":"high";
  send({jsonrpc:"2.0",id:message.id,result:message.params.configId==="model"?{configOptions:[{id:"model",options:[{value:"gpt-5.6-luna"}]},{id:"reasoning_effort",options:[{value:effort}]}]}:{configOptions:[]}});
 } else if(message.method==="session/prompt"){
  promptId=message.id;
  if(scenario==="prompt-auth") { send({jsonrpc:"2.0",id:message.id,error:{code:-32000,message:"authentication required"}}); return; }
  send({jsonrpc:"2.0",method:"session/update",params:{update:{sessionUpdate:"user_message_chunk",content:{text:"must not be returned"}}}});
  send({jsonrpc:"2.0",method:"session/update",params:{update:{sessionUpdate:"agent_message_chunk",content:{text:"answer "}}}});
  send({jsonrpc:"2.0",method:"session/update",params:{update:{sessionUpdate:"agent_message_chunk",content:{text:"with source"}}}});
  if(scenario==="normal"){
   send({jsonrpc:"2.0",method:"session/update",params:{update:{sessionUpdate:"agent_thought_chunk",content:{text:"reasoning"}}}});
   send({jsonrpc:"2.0",method:"session/update",params:{update:{sessionUpdate:"tool_call",title:"web search"}}});
   send({jsonrpc:"2.0",id:"permission-1",method:"session/request_permission",params:{options:[{kind:"allow_once",optionId:"allow"},{kind:"reject_once",optionId:"reject-once"},{kind:"reject_always",optionId:"reject-always"}]}});
  } else if(scenario==="reject-always") send({jsonrpc:"2.0",id:"permission-1",method:"session/request_permission",params:{options:[{kind:"allow_once",optionId:"allow"},{kind:"reject_always",optionId:"reject-always"}]}});
  else if(scenario==="allow-only") send({jsonrpc:"2.0",id:"permission-1",method:"session/request_permission",params:{options:[{kind:"allow_once",optionId:"allow"}]}});
  else if(scenario==="blocking") send({jsonrpc:"2.0",id:"blocking-1",method:"codex/blocking_request",params:{}});
  else if(scenario==="stop") send({jsonrpc:"2.0",id:message.id,result:{stopReason:"max_tokens"}});
 } else if(message.method==="session/cancel"&&scenario==="cancel-permission") send({jsonrpc:"2.0",id:"permission-1",method:"session/request_permission",params:{options:[{kind:"allow_once",optionId:"allow"},{kind:"reject_once",optionId:"reject-once"}]}});
 else if(message.id==="permission-1") send({jsonrpc:"2.0",id:promptId,result:{stopReason:scenario==="cancel-permission"?"cancelled":"end_turn",content:{text:"must not be returned"}}});
});`;

async function fixture(scenario: string) {
    const directory = await mkdtemp(join(tmpdir(), "orchestration-codex-acp-"));
    const command = join(directory, "peer.cjs");
    const requestsPath = join(directory, "requests.jsonl");
    const environmentPath = join(directory, "environment.json");
    await writeFile(command, peer); await chmod(command, 0o755);
    await writeFile(join(directory, "scenario"), scenario); await writeFile(requestsPath, "");
    return { directory, command, requestsPath, environmentPath };
}

function options(f: Awaited<ReturnType<typeof fixture>>, event: (event: { type: "state" | "text" | "thought" | "tool" | "permission"; text: string }) => void) {
    return { command: f.command, cwd: f.directory, model: "gpt-5.6-luna", reasoning: "high", mode: "read-only", permissionPolicy: "reject", webSearch: "cached", event } as const;
}

async function requests(path: string): Promise<Record<string, unknown>[]> {
    return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
}

void test("Codex ACP configures the fixed read-only research session and projects its answer and progress", async () => {
    const f = await fixture("normal"); const events: { type: "state" | "text" | "thought" | "tool" | "permission"; text: string }[] = [];
    const previous = process.env.CODEX_CONFIG; process.env.CODEX_CONFIG = JSON.stringify({ existing: "preserved", mcp_servers: { inherited: { command: "unsafe" } } });
    const driver = new CodexAcpDriver(options(f, event => events.push(event)));
    try {
        await driver.start();
        assert.deepEqual(await driver.runTask("find a current fact"), { output: "answer with source", stopReason: "end_turn" });
        const sent = await requests(f.requestsPath);
        assert.deepEqual(sent.filter(message => typeof message.method === "string").slice(0, 5).map(message => [message.method, message.params]), [
            ["initialize", { protocolVersion: 1, clientInfo: { name: "pi-mesh-worker", version: "1" }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }],
            ["session/new", { cwd: f.directory, mcpServers: [] }],
            ["session/set_mode", { sessionId: "session-1", modeId: "read-only" }],
            ["session/set_config_option", { sessionId: "session-1", configId: "model", value: "gpt-5.6-luna" }],
            ["session/set_config_option", { sessionId: "session-1", configId: "reasoning_effort", value: "high" }],
        ]);
        assert.deepEqual(JSON.parse(await readFile(f.environmentPath, "utf8")), { mode: "read-only", noBrowser: "1", config: { existing: "preserved", mcp_servers: {}, web_search: "cached" } });
        assert.ok(events.some(event => event.type === "thought" && event.text === "reasoning"));
        assert.ok(events.some(event => event.type === "tool" && event.text === "web search"));
        assert.deepEqual(events.filter(event => event.type === "permission").map(event => event.text), ["rejected reject-once"]);
        const permissionResponse = sent.find(message => message.id === "permission-1" && "result" in message);
        assert.deepEqual(permissionResponse?.result, { outcome: { outcome: "selected", optionId: "reject-once" } });
    } finally {
        await driver.shutdown();
        if (previous === undefined) delete process.env.CODEX_CONFIG; else process.env.CODEX_CONFIG = previous;
    }
});

void test("Codex ACP rejects unadvertised protocol, mode, model, and reasoning contracts", async () => {
    for (const scenario of ["protocol", "mode", "model", "effort"]) {
        const f = await fixture(scenario); const driver = new CodexAcpDriver(options(f, () => {}));
        await assert.rejects(driver.start(), scenario === "protocol" ? /protocol version/u : new RegExp(scenario === "effort" ? "reasoning effort" : `required ${scenario}`, "u"));
        await driver.shutdown();
    }
});

void test("Codex ACP rejects permissions without ever selecting an allow option", async () => {
    for (const scenario of ["reject-always", "allow-only"]) {
        const f = await fixture(scenario); const events: { type: "state" | "text" | "thought" | "tool" | "permission"; text: string }[] = [];
        const driver = new CodexAcpDriver(options(f, event => events.push(event))); await driver.start();
        if (scenario === "reject-always") {
            await driver.runTask("task");
            assert.deepEqual(events.filter(event => event.type === "permission").map(event => event.text), ["rejected reject-always"]);
        } else await assert.rejects(driver.runTask("task"), /no exact reject_once or reject_always/u);
        assert.ok(!(await requests(f.requestsPath)).some(message => JSON.stringify(message).includes('"optionId":"allow"')));
        await driver.shutdown();
    }
});

void test("Codex ACP fails unsupported blocking requests and non-end-turn completion", async () => {
    for (const scenario of ["blocking", "stop"]) {
        const f = await fixture(scenario); const driver = new CodexAcpDriver(options(f, () => {})); await driver.start();
        await assert.rejects(driver.runTask("task"), scenario === "blocking" ? /Unsupported blocking ACP request/u : /stopped with max_tokens/u);
        await driver.shutdown();
    }
});

void test("Codex ACP cancellation sends session/cancel and retains partial answer output", async () => {
    const f = await fixture("cancel"); const driver = new CodexAcpDriver(options(f, () => {})); await driver.start();
    const task = driver.runTask("task");
    try {
        await eventually(() => driver.partialOutput() === "answer with source");
        await driver.cancel();
        await eventually(async () => (await requests(f.requestsPath)).some(message => message.method === "session/cancel"));
        assert.equal(driver.partialOutput(), "answer with source");
        assert.ok((await requests(f.requestsPath)).some(message => message.method === "session/cancel" && JSON.stringify(message.params).includes("session-1")));
    } finally {
        await driver.shutdown(); await task.catch(() => {});
    }
});

void test("Codex ACP cancellation resolves a raced permission request as cancelled", async () => {
    const f = await fixture("cancel-permission"); const driver = new CodexAcpDriver(options(f, () => {})); await driver.start();
    const task = driver.runTask("task");
    await eventually(() => driver.partialOutput() === "answer with source");
    await driver.cancel();
    await assert.rejects(task, /stopped with cancelled/u);
    const response = (await requests(f.requestsPath)).find(message => message.id === "permission-1" && "result" in message);
    assert.deepEqual(response?.result, { outcome: { outcome: "cancelled" } });
    await driver.shutdown();
});

void test("Codex ACP authentication failures direct the operator to codex-acp login at startup and during reuse", async () => {
    const startup = await fixture("auth"); const startupDriver = new CodexAcpDriver(options(startup, () => {}));
    await assert.rejects(startupDriver.start(), /codex-acp login/u); await startupDriver.shutdown();
    const turn = await fixture("prompt-auth"); const turnDriver = new CodexAcpDriver(options(turn, () => {})); await turnDriver.start();
    await assert.rejects(turnDriver.runTask("task"), /codex-acp login/u); await turnDriver.shutdown();
});
