import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CursorAcpDriver } from "../extensions_src/utilities/orchestration_cursor_acp.ts";
import { UnconfirmedTerminationError, isUnconfirmedTermination } from "../extensions_src/utilities/orchestration_external_driver.ts";
import { eventually } from "./test_helpers.ts";

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
  const advertised=scenario==="model"?"other-acp-model":"synthetic-acp-model";
  const current=scenario==="model-current"?"default[]":""+advertised;
  const configCurrent=scenario==="model-conflict"?"default[]":current;
  send({jsonrpc:"2.0",id:message.id,result:{sessionId:"session-1",modes:{availableModes:modes},models:{currentModelId:current,availableModels:[{modelId:advertised,name:"Synthetic"}]},configOptions:[{id:"model",currentValue:configCurrent,options:[{value:advertised}]}]}});
 } else if(message.method==="session/set_mode"){
  if(scenario==="mode-update") send({jsonrpc:"2.0",method:"session/update",params:{sessionId:"session-1",update:{sessionUpdate:"current_mode_update",currentModeId:message.params.modeId}}});
  send({jsonrpc:"2.0",id:message.id,result:{}});
 }
 else if(message.method==="session/prompt"){
  promptId=message.id;
  if(scenario==="update-todos-request") send({jsonrpc:"2.0",id:0,method:"cursor/update_todos",params:{todos:[{id:"1",content:"x",status:"pending"}]}});
  else if(scenario==="update-todos-notify"){
   send({jsonrpc:"2.0",method:"cursor/update_todos",params:{todos:[{id:"1",content:"x",status:"pending"}]}});
   send({jsonrpc:"2.0",id:"sync-1",method:"session/update",params:{sessionId:"session-1",update:{sessionUpdate:"agent_message_chunk",content:{text:"continued after todos"}}}});
  } else if(scenario==="wrong-session-update"){
   send({jsonrpc:"2.0",method:"session/update",params:{sessionId:"other-session",update:{sessionUpdate:"agent_message_chunk",content:{text:"foreign"}}}});
   send({jsonrpc:"2.0",method:"session/update",params:{sessionId:"session-1",update:{sessionUpdate:"agent_message_chunk",content:{text:"local"}}}});
   send({jsonrpc:"2.0",id:message.id,result:{stopReason:"end_turn"}});
  } else if(scenario==="wrong-session-permission") send({jsonrpc:"2.0",id:"permission-1",method:"session/request_permission",params:{sessionId:"other-session",options:[{kind:"allow_always",optionId:"allow-always"},{kind:"reject_once",optionId:"reject-once"}]}});
  else if(scenario==="missing-session-update"){
   send({jsonrpc:"2.0",method:"session/update",params:{update:{sessionUpdate:"agent_message_chunk",content:{text:"dropped"}}}});
   send({jsonrpc:"2.0",id:message.id,result:{stopReason:"end_turn"}});
  } else if(scenario==="missing-session-permission") send({jsonrpc:"2.0",id:"permission-1",method:"session/request_permission",params:{options:[{kind:"allow_always",optionId:"allow-always"},{kind:"reject_once",optionId:"reject-once"}]}});
  else if(scenario==="late-update"){
   send({jsonrpc:"2.0",method:"session/update",params:{sessionId:"session-1",update:{sessionUpdate:"agent_message_chunk",content:{text:"cursor answer"}}}});
   send({jsonrpc:"2.0",id:message.id,result:{stopReason:"end_turn"}});
   send({jsonrpc:"2.0",method:"session/update",params:{sessionId:"session-1",update:{sessionUpdate:"agent_message_chunk",content:{text:"late"}}}});
  } else if(scenario==="idle-permission"){
   send({jsonrpc:"2.0",method:"session/update",params:{sessionId:"session-1",update:{sessionUpdate:"agent_message_chunk",content:{text:"cursor answer"}}}});
   send({jsonrpc:"2.0",id:message.id,result:{stopReason:"end_turn"}});
   send({jsonrpc:"2.0",id:"permission-late",method:"session/request_permission",params:{sessionId:"session-1",options:[{kind:"allow_always",optionId:"allow-always"}]}});
  } else {
   send({jsonrpc:"2.0",method:"session/update",params:{sessionId:"session-1",update:{sessionUpdate:"agent_message_chunk",content:{text:"cursor answer"}}}});
   if(scenario==="blocking") send({jsonrpc:"2.0",id:"blocking-1",method:"cursor/blocking_request",params:{sessionId:"session-1"}});
   else if(scenario==="stop") send({jsonrpc:"2.0",id:message.id,result:{stopReason:"max_tokens"}});
   else if(scenario==="missing-stop-reason") send({jsonrpc:"2.0",id:message.id,result:{}});
   else if(scenario==="malformed-stop-reason") send({jsonrpc:"2.0",id:message.id,result:{stopReason:1}});
   else {
   let options;
   if(scenario==="reject-always") options=[{kind:"allow_once",optionId:"allow-once"},{kind:"reject_always",optionId:"reject-always"}];
   else if(scenario==="reject-missing") options=[{kind:"allow_once",optionId:"allow-once"}];
   else if(scenario==="allow-once") options=[{kind:"reject_once",optionId:"reject-once"},{kind:"allow_once",optionId:"allow-once"}];
   else if(scenario==="reject-only") options=[{kind:"reject_once",optionId:"reject-once"}];
   else options=[{kind:"allow_once",optionId:"allow-once"},{kind:"allow_always",optionId:"allow-always"},{kind:"reject_once",optionId:"reject-once"},{kind:"reject_always",optionId:"reject-always"}];
    send({jsonrpc:"2.0",id:"permission-1",method:"session/request_permission",params:{sessionId:"session-1",options}});
   }
  }
 } else if(message.id==="permission-1") send({jsonrpc:"2.0",id:promptId,result:{stopReason:"end_turn"}});
 else if(message.id===0){
  send({jsonrpc:"2.0",method:"session/update",params:{sessionId:"session-1",update:{sessionUpdate:"agent_message_chunk",content:{text:"continued after todos"}}}});
  send({jsonrpc:"2.0",id:promptId,result:{stopReason:"end_turn"}});
 } else if(message.id==="sync-1") send({jsonrpc:"2.0",id:promptId,result:{stopReason:"end_turn"}});
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
    return { command: f.command, cwd: f.directory, model: "synthetic-cli-alias", expectedAcpModelId: "synthetic-acp-model", mode, permissionPolicy: mode === "ask" ? "reject" as const : "allow-always" as const, event };
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

// Admission: Cursor reports the selected mode as an out-of-turn session update during startup; this state acknowledgement must not poison the first task.
void test("Cursor ACP accepts the startup current_mode_update and remains reusable", async () => {
    const f = await fixture("mode-update"); const events: Event[] = [];
    const driver = new CursorAcpDriver(options(f, "ask", event => events.push(event)));
    try {
        await driver.start();
        assert.deepEqual(await driver.runTask("bounded task"), { output: "cursor answer", stopReason: "end_turn" });
        assert.deepEqual(events.filter(event => event.type === "state" && event.text.startsWith("mode ")).map(event => event.text), ["mode ask"]);
        assert.equal(driver.fatalError(), undefined);
    } finally { await driver.shutdown(); }
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
    for (const scenario of ["reject-always", "reject-missing"] as const) {
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

// Admission: missing/malformed prompt stopReason is not a provider terminal reason; treating it as a reusable confirmed stop would idle a child whose turn never ended.
void test("Cursor ACP fails unsupported blocking requests as unconfirmed termination and non-end-turn completion as a confirmed stop", async () => {
    const blocking = await fixture("blocking"); const blockingDriver = new CursorAcpDriver(options(blocking, "agent", () => {})); await blockingDriver.start();
    await assert.rejects(blockingDriver.runTask("task"), error => {
        assert.equal(isUnconfirmedTermination(error), true);
        assert.match((error as Error).message, /Unsupported blocking ACP request/u);
        return true;
    });
    await blockingDriver.shutdown();
    const stopped = await fixture("stop"); const stopDriver = new CursorAcpDriver(options(stopped, "agent", () => {})); await stopDriver.start();
    await assert.rejects(stopDriver.runTask("task"), error => {
        assert.equal(error instanceof UnconfirmedTerminationError, false);
        assert.match((error as Error).message, /stopped with max_tokens/u);
        return true;
    });
    await stopDriver.shutdown();
    for (const scenario of ["missing-stop-reason", "malformed-stop-reason"] as const) {
        const missing = await fixture(scenario); const missingDriver = new CursorAcpDriver(options(missing, "agent", () => {})); await missingDriver.start();
        await assert.rejects(missingDriver.runTask("task"), error => {
            assert.equal(isUnconfirmedTermination(error), true);
            assert.match((error as Error).message, /without a stopReason/u);
            return true;
        });
        await missingDriver.shutdown();
    }
});

// Admission: an in-turn cursor/update_todos request can abort runTask; typecheck cannot observe the rejected JSON-RPC result or later output.
void test("Cursor ACP rejects cursor/update_todos requests without failing the turn", { timeout: 15_000 }, async () => {
    const f = await fixture("update-todos-request");
    const driver = new CursorAcpDriver(options(f, "agent", () => {}));
    try {
        await driver.start();
        assert.deepEqual(await driver.runTask("bounded task"), { output: "continued after todos", stopReason: "end_turn" });
        const reply = (await requests(f.requestsPath)).find(message => message.id === 0);
        assert.ok(reply && "result" in reply && !("error" in reply));
        const outcome = (reply.result as { outcome?: { outcome?: unknown; reason?: unknown } }).outcome;
        assert.equal(outcome?.outcome, "rejected");
        const reason = outcome?.reason;
        assert.ok(typeof reason === "string");
        assert.match(reason, /not supported/iu);
    } finally { await driver.shutdown(); }
});

// Admission: an ID-less cursor/update_todos notification can still fail the turn or emit a stray reply; typecheck cannot observe wire silence.
void test("Cursor ACP does not reply to cursor/update_todos notifications and continues the turn", { timeout: 15_000 }, async () => {
    const f = await fixture("update-todos-notify");
    const driver = new CursorAcpDriver(options(f, "agent", () => {}));
    try {
        await driver.start();
        assert.deepEqual(await driver.runTask("bounded task"), { output: "continued after todos", stopReason: "end_turn" });
        const replies = (await requests(f.requestsPath)).filter(message => "result" in message || "error" in message);
        assert.equal(replies.length, 1);
        assert.equal(replies[0]?.id, "sync-1");
        assert.ok(!("error" in (replies[0] ?? {})));
    } finally { await driver.shutdown(); }
});

// Admission: session/update is a session-scoped ACP notification; types cannot observe a foreign sessionId being folded into the active turn.
// Given a prompt that also receives a different session's update, the driver keeps only the matching session text and blocks reuse.
void test("Cursor ACP ignores a foreign session/update and blocks reuse", { timeout: 15_000 }, async () => {
    const f = await fixture("wrong-session-update");
    const driver = new CursorAcpDriver(options(f, "agent", () => {}));
    try {
        await driver.start();
        assert.deepEqual(await driver.runTask("bounded task"), { output: "local", stopReason: "end_turn" });
        const fatal = driver.fatalError();
        assert.equal(isUnconfirmedTermination(fatal), true);
        assert.match(fatal!.message, /sessionId does not match/u);
        await assert.rejects(driver.runTask("next"), isUnconfirmedTermination);
    } finally { await driver.shutdown(); }
});

// Admission: a permission request can grant write access; types cannot observe a foreign session option being selected.
void test("Cursor ACP does not allow a foreign-session permission request", { timeout: 15_000 }, async () => {
    const f = await fixture("wrong-session-permission");
    const driver = new CursorAcpDriver(options(f, "agent", () => {}));
    try {
        await driver.start();
        assert.deepEqual(await driver.runTask("bounded task"), { output: "", stopReason: "end_turn" });
        const permission = (await requests(f.requestsPath)).find(message => message.id === "permission-1" && ("result" in message || "error" in message));
        assert.deepEqual(permission?.result, { outcome: { outcome: "cancelled" } });
        assert.equal(isUnconfirmedTermination(driver.fatalError()), true);
    } finally { await driver.shutdown(); }
});

// Admission: session/update and permission are session-scoped; a missing sessionId is as untrusted as a foreign one.
void test("Cursor ACP requires sessionId on session/update and permission requests", { timeout: 15_000 }, async () => {
    const update = await fixture("missing-session-update");
    const updateDriver = new CursorAcpDriver(options(update, "agent", () => {}));
    try {
        await updateDriver.start();
        assert.deepEqual(await updateDriver.runTask("bounded task"), { output: "", stopReason: "end_turn" });
        assert.equal(updateDriver.partialOutput().includes("dropped"), false);
        assert.equal(isUnconfirmedTermination(updateDriver.fatalError()), true);
        assert.match(updateDriver.fatalError()!.message, /sessionId is missing/u);
        await assert.rejects(updateDriver.runTask("next"), isUnconfirmedTermination);
    } finally { await updateDriver.shutdown(); }
    const permission = await fixture("missing-session-permission");
    const permissionDriver = new CursorAcpDriver(options(permission, "agent", () => {}));
    try {
        await permissionDriver.start();
        assert.deepEqual(await permissionDriver.runTask("bounded task"), { output: "", stopReason: "end_turn" });
        const reply = (await requests(permission.requestsPath)).find(message => message.id === "permission-1" && ("result" in message || "error" in message));
        assert.deepEqual(reply?.result, { outcome: { outcome: "cancelled" } });
        assert.equal(isUnconfirmedTermination(permissionDriver.fatalError()), true);
        assert.match(permissionDriver.fatalError()!.message, /sessionId is missing/u);
    } finally { await permissionDriver.shutdown(); }
});

// Admission: ACP may emit session/update after end_turn on the same stdout burst; applying it as in-turn text would reuse a child whose prior work already completed.
void test("Cursor ACP does not apply a late session/update as a new turn and blocks reuse", { timeout: 15_000 }, async () => {
    const f = await fixture("late-update");
    const driver = new CursorAcpDriver(options(f, "agent", () => {}));
    try {
        await driver.start();
        assert.deepEqual(await driver.runTask("bounded task"), { output: "cursor answer", stopReason: "end_turn" });
        await eventually(() => isUnconfirmedTermination(driver.fatalError()));
        assert.equal(driver.partialOutput().includes("late"), false);
        await assert.rejects(driver.runTask("next"), isUnconfirmedTermination);
    } finally { await driver.shutdown(); }
});

// Admission: a permission request with no active turn can still be granted if the client answers selected; types cannot observe that the option was cancelled.
void test("Cursor ACP does not allow a permission request after the turn has ended", { timeout: 15_000 }, async () => {
    const f = await fixture("idle-permission");
    const driver = new CursorAcpDriver(options(f, "agent", () => {}));
    try {
        await driver.start();
        assert.deepEqual(await driver.runTask("bounded task"), { output: "cursor answer", stopReason: "end_turn" });
        await eventually(async () => (await requests(f.requestsPath)).some(message => message.id === "permission-late" && "result" in message));
        const permission = (await requests(f.requestsPath)).find(message => message.id === "permission-late" && "result" in message);
        assert.deepEqual(permission?.result, { outcome: { outcome: "cancelled" } });
        assert.equal(isUnconfirmedTermination(driver.fatalError()), true);
    } finally { await driver.shutdown(); }
});
