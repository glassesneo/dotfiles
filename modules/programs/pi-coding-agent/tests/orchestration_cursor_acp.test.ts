import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CursorAcpDriver } from "../extensions_src/utilities/orchestration_cursor_acp.ts";

const peer = `#!/usr/bin/env node
const fs=require("fs"); const readline=require("readline");
const record=m=>fs.appendFileSync(process.cwd()+"/requests.jsonl",JSON.stringify(m)+"\\n");
const send=m=>process.stdout.write(JSON.stringify(m)+"\\n");
const scenario=fs.readFileSync(process.cwd()+"/scenario","utf8").trim();
let promptId; const input=readline.createInterface({input:process.stdin});
input.on("line",line=>{const message=JSON.parse(line); record(message);
 if(message.method==="initialize") send({jsonrpc:"2.0",id:message.id,result:{protocolVersion:scenario==="protocol"?2:1}});
 else if(message.method==="session/new"){
  const modes=scenario==="mode"?[{id:"plan"}]:[{id:"ask"},{id:"agent"}];
  const advertised=scenario==="model"?"grok-other":"grok-4.5[effort=high,fast=true]";
  const current=scenario==="model-current"?"default[]":""+advertised;
  const configCurrent=scenario==="model-conflict"?"default[]":current;
  send({jsonrpc:"2.0",id:message.id,result:{sessionId:"session-1",modes:{availableModes:modes},models:{currentModelId:current,availableModels:[{modelId:advertised,name:"grok-4.5"}]},configOptions:[{id:"model",currentValue:configCurrent,options:[{value:advertised}]}]}});
 } else if(message.method==="session/set_mode") send({jsonrpc:"2.0",id:message.id,result:{}});
 else if(message.method==="session/prompt"){
  promptId=message.id;
  send({jsonrpc:"2.0",method:"session/update",params:{update:{sessionUpdate:"agent_message_chunk",content:{text:"cursor answer"}}}});
  if(scenario==="blocking") send({jsonrpc:"2.0",id:"blocking-1",method:"cursor/blocking_request",params:{}});
  else if(scenario==="stop") send({jsonrpc:"2.0",id:message.id,result:{stopReason:"max_tokens"}});
  else {
   let options;
   if(scenario==="reject-always") options=[{kind:"allow_once",optionId:"allow-once"},{kind:"reject_always",optionId:"reject-always"}];
   else if(scenario==="allow-only") options=[{kind:"allow_once",optionId:"allow-once"}];
   else if(scenario==="allow-once") options=[{kind:"reject_once",optionId:"reject-once"},{kind:"allow_once",optionId:"allow-once"}];
   else if(scenario==="reject-only") options=[{kind:"reject_once",optionId:"reject-once"}];
   else options=[{kind:"allow_once",optionId:"allow-once"},{kind:"allow_always",optionId:"allow-always"},{kind:"reject_once",optionId:"reject-once"},{kind:"reject_always",optionId:"reject-always"}];
   send({jsonrpc:"2.0",id:"permission-1",method:"session/request_permission",params:{options}});
  }
 } else if(message.id==="permission-1") send({jsonrpc:"2.0",id:promptId,result:{stopReason:"end_turn"}});
});`;

type Event = { type: "state" | "text" | "thought" | "tool" | "permission"; text: string };

async function fixture(scenario: string) {
    const directory = await mkdtemp(join(tmpdir(), "orchestration-cursor-acp-"));
    const command = join(directory, "peer.cjs");
    const requestsPath = join(directory, "requests.jsonl");
    await writeFile(command, peer); await chmod(command, 0o755);
    await writeFile(join(directory, "scenario"), scenario); await writeFile(requestsPath, "");
    return { directory, command, requestsPath };
}

function options(f: Awaited<ReturnType<typeof fixture>>, mode: "ask" | "agent", event: (event: Event) => void) {
    return { command: f.command, cwd: f.directory, model: "cursor-grok-4.5-high-fast", mode, permissionPolicy: mode === "ask" ? "reject" as const : "allow-always" as const, event };
}

async function requests(path: string): Promise<Record<string, unknown>[]> {
    return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
}

// Admission: the final ACP capability and permission exchange is the mutation boundary; profile validation alone cannot observe provider drift or the option actually selected.
void test("Cursor ACP resolves the configured CLI model alias to the active ACP model and applies exact mode permissions", async () => {
    for (const mode of ["ask", "agent"] as const) {
        const f = await fixture("normal"); const events: Event[] = [];
        const driver = new CursorAcpDriver(options(f, mode, event => events.push(event)));
        try {
            await driver.start();
            assert.deepEqual(await driver.runTask("bounded task"), { output: "cursor answer", stopReason: "end_turn" });
            const sent = await requests(f.requestsPath);
            assert.ok(sent.some(message => message.method === "session/set_mode" && JSON.stringify(message.params) === JSON.stringify({ sessionId: "session-1", modeId: mode })));
            const permission = sent.find(message => message.id === "permission-1" && "result" in message);
            assert.deepEqual(permission?.result, { outcome: { outcome: "selected", optionId: mode === "ask" ? "reject-once" : "allow-always" } });
            assert.deepEqual(events.filter(event => event.type === "permission").map(event => event.text), [mode === "ask" ? "rejected reject-once" : "selected allow-always"]);
        } finally { await driver.shutdown(); }
    }
});

void test("Cursor ACP fails closed when protocol, requested mode, or selected model is not advertised", async () => {
    for (const scenario of ["protocol", "mode", "model", "model-current", "model-conflict"]) {
        const f = await fixture(scenario); const driver = new CursorAcpDriver(options(f, "ask", () => {}));
        await assert.rejects(driver.start(), scenario === "protocol" ? /protocol version/u : new RegExp(`required ${scenario.startsWith("model") ? "model" : scenario}`, "u"));
        await driver.shutdown();
        assert.ok(!(await requests(f.requestsPath)).some(message => message.method === "session/prompt"));
    }
});

void test("Cursor read rejects allow-only requests and write prefers persistent then one-turn allow", async () => {
    for (const scenario of ["reject-always", "allow-only"] as const) {
        const f = await fixture(scenario); const driver = new CursorAcpDriver(options(f, "ask", () => {})); await driver.start();
        if (scenario === "reject-always") {
            await driver.runTask("task");
            const permission = (await requests(f.requestsPath)).find(message => message.id === "permission-1" && "result" in message);
            assert.deepEqual(permission?.result, { outcome: { outcome: "selected", optionId: "reject-always" } });
        } else await assert.rejects(driver.runTask("task"), /no exact reject option/u);
        assert.ok(!(await requests(f.requestsPath)).some(message => JSON.stringify(message).includes('"optionId":"allow-once"')));
        await driver.shutdown();
    }
    for (const scenario of ["allow-once", "reject-only"] as const) {
        const f = await fixture(scenario); const driver = new CursorAcpDriver(options(f, "agent", () => {})); await driver.start();
        if (scenario === "allow-once") {
            await driver.runTask("task");
            const permission = (await requests(f.requestsPath)).find(message => message.id === "permission-1" && "result" in message);
            assert.deepEqual(permission?.result, { outcome: { outcome: "selected", optionId: "allow-once" } });
        } else await assert.rejects(driver.runTask("task"), /no exact allow-always or allow-once option/u);
        await driver.shutdown();
    }
});

void test("Cursor ACP fails unsupported blocking requests and non-end-turn completion", async () => {
    for (const scenario of ["blocking", "stop"]) {
        const f = await fixture(scenario); const driver = new CursorAcpDriver(options(f, "agent", () => {})); await driver.start();
        await assert.rejects(driver.runTask("task"), scenario === "blocking" ? /Unsupported blocking ACP request/u : /stopped with max_tokens/u);
        await driver.shutdown();
    }
});
