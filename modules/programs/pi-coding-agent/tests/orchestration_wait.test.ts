import assert from "node:assert/strict";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
    createAgentSession,
    DefaultResourceLoader,
    defineTool,
    ModelRuntime,
    SessionManager,
    SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isJoinableAgentEnd } from "../extensions_src/utilities/orchestration_execution.ts";
import { MeshArmedWait } from "../extensions_src/utilities/orchestration_wait.ts";
import { createEndResponseTool } from "../extensions_src/orchestration.ts";

const within = async <T>(promise: Promise<T>, label: string): Promise<T> => {
    let timeout: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error(`${label} timed out`)), 2_000);
            }),
        ]);
    } finally {
        if (timeout !== undefined) clearTimeout(timeout);
    }
};

const countMessagesContaining = (messages: unknown[], text: string): number =>
    messages.filter(message => JSON.stringify(message).includes(text)).length;

const yieldTool = () => defineTool({
    name: "end_response",
    label: "End response",
    description: "Yield the current response",
    parameters: Type.Object({}),
    async execute(toolCallId: string) {
        return {
            content: [{ type: "text", text: JSON.stringify({ ended: true }) }],
            details: { kind: "end_response", toolCallId, ended: true },
            terminate: true,
        };
    },
});

// Admission: a wake between waiter registration and inspection can otherwise leave an armed run hung; types do not observe the asynchronous ordering.
// Given pending work whose queue is populated during inspection, the waiter resumes only after the queue observation and retains its arm for the next boundary.
void test("armed wait closes registration races and aborts without a rejected handler", async () => {
    const wait = new MeshArmedWait();
    wait.arm("binding");
    let inspections = 0;
    const resumed = await wait.wait("binding", undefined, async () => {
        inspections += 1;
        if (inspections === 1) {
            wait.notifyQueued();
            await Promise.resolve();
            return "drained";
        }
        return "queued";
    });
    assert.equal(resumed, "resumed");
    assert.equal(inspections, 2);
    assert.equal(wait.currentState, "armed-running");

    const abort = new AbortController();
    const blocked = wait.wait("binding", abort.signal, async () => "pending");
    abort.abort(new Error("stop"));
    assert.equal(await blocked, "aborted");
    assert.equal(wait.currentState, "disarmed");
});

// Admission: competing wakes must not let a later mesh-event rewrite a user origin already accepted for the same run.
void test("first accepted wake origin wins", () => {
    const wait = new MeshArmedWait();
    wait.arm("binding");
    wait.notifyQueued("user");
    wait.notifyQueued("mesh-event");
    assert.equal(wait.peekWakeOrigin(), "user");
    assert.equal(wait.takeWakeOrigin(), "user");
    assert.equal(wait.peekWakeOrigin(), undefined);
});

for (const delivery of ["sendMessage", "steer"] as const) {
    // Admission: Pi owns agent_end awaiting and queue continuation ordering; mock emitters cannot detect an upstream regression that settles or loses input between low-level runs.
    // Given one prompt held in an awaited joinable agent_end, when an extension message or native queued input crosses AgentSession, the same active session run consumes it exactly once before its only settlement.
    void test(`real AgentSession continues joinable agent_end through ${delivery}`, async () => {
        const armed = new MeshArmedWait();
        const lifecycle: string[] = [];
        const queuedText = `queued-${delivery}`;
        let releaseWaiting!: () => void;
        const waiting = new Promise<void>(resolve => { releaseWaiting = resolve; });
        let firstEnd = true;
        let idleWhileHeld: boolean | undefined;
        let queuedMessageCount: number | undefined;
        let sendQueuedMessage: (() => void) | undefined;

        const faux = fauxProvider({ provider: `auto-join-${delivery}` });
        faux.setResponses([
            fauxAssistantMessage(fauxToolCall("end_response", {}, { id: "yield" }), { stopReason: "toolUse" }),
            context => {
                queuedMessageCount = countMessagesContaining(context.messages, queuedText);
                return fauxAssistantMessage("continued in the same AgentSession run");
            },
        ]);
        const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false, modelsPath: null });
        modelRuntime.registerNativeProvider(faux.provider);
        const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
        const loader = new DefaultResourceLoader({
            cwd: process.cwd(),
            agentDir: process.cwd(),
            settingsManager,
            extensionFactories: [{
                name: `auto-join-${delivery}`,
                factory: pi => {
                    sendQueuedMessage = () => {
                        pi.sendMessage({ customType: "mesh-event", content: queuedText, display: false }, { deliverAs: "steer" });
                        armed.notifyQueued();
                    };
                    pi.on("agent_start", () => { lifecycle.push("agent_start"); });
                    pi.on("agent_end", async (event, ctx) => {
                        lifecycle.push("agent_end");
                        if (!firstEnd) return;
                        firstEnd = false;
                        if (!isJoinableAgentEnd(event.messages)) return;
                        idleWhileHeld = ctx.isIdle();
                        releaseWaiting();
                        armed.arm("session");
                        const poll = setInterval(() => {
                            if (ctx.hasPendingMessages()) armed.notifyQueued("user");
                        }, 1);
                        try {
                            assert.equal(
                                await armed.wait("session", ctx.signal, async () => ctx.hasPendingMessages() ? "queued" : "pending"),
                                "resumed",
                            );
                        } finally {
                            clearInterval(poll);
                        }
                    });
                    pi.on("agent_settled", (_event, ctx) => { lifecycle.push(`agent_settled:${ctx.isIdle()}`); });
                },
            }],
        });
        await loader.reload();
        const { session } = await createAgentSession({
            cwd: process.cwd(),
            agentDir: process.cwd(),
            model: faux.getModel(),
            modelRuntime,
            resourceLoader: loader,
            settingsManager,
            sessionManager: SessionManager.inMemory(),
            tools: ["end_response"],
            customTools: [yieldTool()],
        });
        try {
            const prompt = session.prompt("yield and wait");
            await within(waiting, "agent_end wait entry");
            assert.equal(idleWhileHeld, false);
            assert.equal(session.isStreaming, true);
            assert.equal(lifecycle.some(event => event.startsWith("agent_settled")), false);

            if (delivery === "sendMessage") {
                assert.ok(sendQueuedMessage);
                sendQueuedMessage();
            } else {
                await session[delivery](queuedText);
            }

            await within(prompt, "AgentSession continuation");
            assert.equal(queuedMessageCount, 1);
            assert.deepEqual(lifecycle, ["agent_start", "agent_end", "agent_start", "agent_end", "agent_settled:true"]);
            assert.equal(faux.state.callCount, 2);
            assert.equal(session.isStreaming, false);
        } finally {
            session.dispose();
        }
    });
}

// Admission: an awaited agent_end that rejects or ignores cancellation can prevent the consumer from ever regaining an idle session; type checks cannot observe this lifecycle failure.
// Given a joinable AgentSession blocked in agent_end, when the native session abort crosses the active signal, the wait exits normally without a continuation and settlement completes.
void test("real AgentSession abort releases awaited agent_end", async () => {
    const armed = new MeshArmedWait();
    let releaseWaiting!: () => void;
    const waiting = new Promise<void>(resolve => { releaseWaiting = resolve; });
    let waitOutcome: string | undefined;
    let settlements = 0;
    const faux = fauxProvider({ provider: "auto-join-abort" });
    faux.setResponses([
        fauxAssistantMessage(fauxToolCall("end_response", {}, { id: "yield" }), { stopReason: "toolUse" }),
    ]);
    const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false, modelsPath: null });
    modelRuntime.registerNativeProvider(faux.provider);
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir: process.cwd(),
        settingsManager,
        extensionFactories: [{
            name: "auto-join-abort",
            factory: pi => {
                pi.on("agent_end", async (event, ctx) => {
                    if (!isJoinableAgentEnd(event.messages)) return;
                    armed.arm("session");
                    releaseWaiting();
                    waitOutcome = await armed.wait("session", ctx.signal, async () => "pending");
                });
                pi.on("agent_settled", () => { settlements += 1; });
            },
        }],
    });
    await loader.reload();
    const { session } = await createAgentSession({
        model: faux.getModel(), modelRuntime, resourceLoader: loader, settingsManager,
        sessionManager: SessionManager.inMemory(), tools: ["end_response"], customTools: [yieldTool()],
    });
    try {
        const prompt = session.prompt("yield and wait for abort");
        await within(waiting, "abort wait entry");
        assert.equal(session.isStreaming, true);
        await within(session.abort(), "AgentSession abort");
        await within(prompt, "aborted prompt settlement");
        assert.equal(waitOutcome, "aborted");
        assert.equal(settlements, 1);
        assert.equal(faux.state.callCount, 1);
        assert.equal(session.isStreaming, false);
    } finally {
        session.dispose();
    }
});

// Admission: waiting on an error agent_end can block Pi's retry, compaction, or fallback owner; the failure is visible only at the real AgentSession lifecycle boundary.
// Given a session whose faux provider ends with an error, when agent_end crosses the extension hook, the hook bypasses waiting and AgentSession settles without an injected continuation.
void test("real AgentSession error bypasses auto-join", async () => {
    const armed = new MeshArmedWait();
    let waitEntered = false;
    let errorEndObserved = false;
    let settlements = 0;
    const faux = fauxProvider({ provider: "auto-join-error" });
    faux.setResponses([
        fauxAssistantMessage("provider failed", { stopReason: "error", errorMessage: "synthetic provider failure" }),
    ]);
    const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false, modelsPath: null });
    modelRuntime.registerNativeProvider(faux.provider);
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir: process.cwd(),
        settingsManager,
        extensionFactories: [{
            name: "auto-join-error",
            factory: pi => {
                pi.on("agent_end", async (event, ctx) => {
                    if (!isJoinableAgentEnd(event.messages)) {
                        errorEndObserved = true;
                        assert.equal(ctx.isIdle(), false);
                        return;
                    }
                    waitEntered = true;
                    armed.arm("session");
                    await armed.wait("session", ctx.signal, async () => "pending");
                });
                pi.on("agent_settled", () => {
                    settlements += 1;
                    armed.disarm();
                });
            },
        }],
    });
    await loader.reload();
    const { session } = await createAgentSession({
        model: faux.getModel(), modelRuntime, resourceLoader: loader, settingsManager,
        sessionManager: SessionManager.inMemory(),
    });
    try {
        await within(session.prompt("error without join"), "error settlement");
        assert.equal(errorEndObserved, true);
        assert.equal(waitEntered, false);
        assert.equal(settlements, 1);
        assert.equal(faux.state.callCount, 1);
        assert.equal(armed.currentState, "disarmed");
        assert.equal(session.isStreaming, false);
    } finally {
        session.dispose();
    }
});

// Admission: mixed end_response must not terminate the AgentSession; only a later standalone success yields. Tool-level batch maps cannot observe Pi's real tool_call/execute ordering.
void test("real AgentSession rejects mixed end_response and yields only on a later standalone call", async () => {
    const batch = new Map<string, string>();
    let otherRan = false;
    const joinableEnds: boolean[] = [];
    const end = createEndResponseTool({
        configPath: "/missing",
        env: {},
        exec: async () => ({ stdout: "", stderr: "", code: 1 }),
        currentBatchTools: () => batch,
    });
    const companion = defineTool({
        name: "other_tool",
        label: "Other",
        description: "Companion tool for mixed batch checks",
        parameters: Type.Object({}),
        async execute() {
            otherRan = true;
            return { content: [{ type: "text", text: "ok" }], details: { kind: "other" } };
        },
    });
    const faux = fauxProvider({ provider: "mixed-end-response" });
    faux.setResponses([
        fauxAssistantMessage([
            fauxToolCall("end_response", {}, { id: "yield" }),
            fauxToolCall("other_tool", {}, { id: "other" }),
        ], { stopReason: "toolUse" }),
        fauxAssistantMessage(fauxToolCall("end_response", {}, { id: "yield-alone" }), { stopReason: "toolUse" }),
    ]);
    const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false, modelsPath: null });
    modelRuntime.registerNativeProvider(faux.provider);
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir: process.cwd(),
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [{
            name: "mixed-end-response",
            factory: pi => {
                pi.on("turn_start", () => { batch.clear(); });
                pi.on("tool_call", event => { batch.set(event.toolCallId, event.toolName); });
                pi.on("agent_end", event => { joinableEnds.push(isJoinableAgentEnd(event.messages)); });
            },
        }],
    });
    await loader.reload();
    const { session } = await createAgentSession({
        cwd: process.cwd(),
        agentDir: process.cwd(),
        model: faux.getModel(),
        modelRuntime,
        resourceLoader: loader,
        settingsManager,
        sessionManager: SessionManager.inMemory(),
        tools: ["end_response", "other_tool"],
        customTools: [end, companion],
    });
    try {
        await within(session.prompt("mixed then standalone yield"), "mixed end_response settlement");
        assert.equal(otherRan, true);
        assert.equal(faux.state.callCount, 2);
        assert.equal(joinableEnds.filter(value => value).length, 1);
        assert.equal(joinableEnds.at(-1), true);
        assert.equal(session.isStreaming, false);
    } finally {
        session.dispose();
    }
});
