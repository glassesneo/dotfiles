import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GC_NOTICE_MAX_AGENTS, NOTICE_REASON_MAX_BYTES, TUI_NOTICE_SCHEMA_VERSION, acknowledgeDisplayedTuiNotice, createExplicitStopNotice, createGcStopNotice, listPendingTuiNotices, validateTuiNotice } from "../extensions_src/utilities/orchestration_notices.ts";

const recipient = { endpointId: "root:parent" };
const displayedAt = "2099-01-01T00:00:00.000Z";
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "mesh-notices-")); const meshId = randomUUID();
    const meshDirectory = join(root, "meshes", meshId); await mkdir(meshDirectory, { recursive: true, mode: 0o700 });
    return { root, meshId, notices: join(meshDirectory, "notices") };
}
function explicitPayload(reason = "capacity was needed") {
    return { stopRequestId: randomUUID(), agentId: randomUUID(), agent: "worker", access: "read" as const, source: "peer" as const, reason };
}
function gcPayload(gcPassId = randomUUID(), count = 2) {
    return { gcPassId, confirmed: Array.from({ length: count }, (_, index) => ({ agentId: randomUUID(), agent: index % 2 ? "explorer" : "worker", access: "read" as const, purpose: "Retain idle wave", source: "gc-role" as const, reason: `role collection ${index}` })), failedCount: 1, pendingCount: 0 };
}

// Given one confirmed explicit stop, when it crosses notice creation, the parent observes one strict bounded record and retrying the same request does not duplicate it.
void test("explicit notice creation is strict, bounded, nonredundant, and idempotent", async () => {
    const f = await fixture();
    try {
        const payload = explicitPayload();
        const first = await createExplicitStopNotice(f.root, f.meshId, { ...recipient, requesterEndpointId: "agent:requester", payload });
        const retried = await createExplicitStopNotice(f.root, f.meshId, { ...recipient, requesterEndpointId: "agent:requester", payload });
        assert.ok(first); assert.equal(retried?.noticeId, first.noticeId);
        assert.deepEqual(await readdir(f.notices), [`${first.noticeId}.json`]);
        assert.equal(validateTuiNotice(JSON.parse(await readFile(join(f.notices, `${first.noticeId}.json`), "utf8"))).state, "pending");
        assert.equal(first.schemaVersion, TUI_NOTICE_SCHEMA_VERSION);
        assert.equal(first.kind, "explicit-stop");
        assert.equal(first.payload.agent, "worker");
        assert.equal(first.payload.access, "read");
        assert.equal("role" in first.payload, false);
        assert.equal(await createExplicitStopNotice(f.root, f.meshId, { ...recipient, requesterEndpointId: recipient.endpointId, payload: explicitPayload() }), undefined);
        await assert.rejects(createExplicitStopNotice(f.root, f.meshId, { ...recipient, requesterEndpointId: "agent:requester", payload: explicitPayload("界".repeat(Math.floor(NOTICE_REASON_MAX_BYTES / 3) + 1)) }), /UTF-8 bytes/u);
        await assert.rejects(createExplicitStopNotice(f.root, f.meshId, { ...recipient, requesterEndpointId: "agent:requester", payload: { ...payload, reason: "changed" } }), /different content/u);
    } finally { await rm(f.root, { recursive: true, force: true }); }
});

// Given one GC pass summarized for multiple parents, when summaries cross notice creation, each parent observes exactly one pass-scoped aggregate identity.
void test("GC notice identity aggregates once per pass and parent", async () => {
    const f = await fixture();
    try {
        const payload = gcPayload();
        const parent = await createGcStopNotice(f.root, f.meshId, { ...recipient, payload });
        assert.ok(parent.kind === "gc-stop");
        assert.equal(parent.schemaVersion, TUI_NOTICE_SCHEMA_VERSION);
        assert.equal(parent.payload.confirmed[0]?.agent, "worker");
        assert.equal(parent.payload.confirmed[0]?.access, "read");
        assert.equal(parent.payload.confirmed[0]?.purpose, "Retain idle wave");
        assert.equal("role" in (parent.payload.confirmed[0] ?? {}), false);
        const retry = await createGcStopNotice(f.root, f.meshId, { ...recipient, payload });
        const other = await createGcStopNotice(f.root, f.meshId, { endpointId: "agent:other", payload });
        assert.equal(retry.noticeId, parent.noticeId); assert.notEqual(other.noticeId, parent.noticeId);
        assert.equal((await readdir(f.notices)).length, 2);
        const updatedPayload = { ...payload, confirmed: [], failedCount: 0, pendingCount: payload.confirmed.length }; const updated = await createGcStopNotice(f.root, f.meshId, { ...recipient, payload: updatedPayload }, true); assert.deepEqual(updated.payload, updatedPayload);
        const acknowledged = await acknowledgeDisplayedTuiNotice(f.root, f.meshId, parent.noticeId, recipient, displayedAt); const preserved = await createGcStopNotice(f.root, f.meshId, { ...recipient, payload }, true); assert.equal(preserved.state, "acknowledged"); assert.deepEqual(preserved.payload, acknowledged.payload);
        await assert.rejects(createGcStopNotice(f.root, f.meshId, { ...recipient, payload: gcPayload(payload.gcPassId, GC_NOTICE_MAX_AGENTS + 1) }), /at most/u);
    } finally { await rm(f.root, { recursive: true, force: true }); }
});

// Given valid and malformed durable notice files, when listing crosses the filesystem boundary, the endpoint receives valid pending records in stable order while malformed siblings remain isolated.
void test("pending notice listing is reload-safe, targets endpoint, and isolates malformed siblings", async () => {
    const f = await fixture();
    try {
        const first = await createExplicitStopNotice(f.root, f.meshId, { ...recipient, requesterEndpointId: "agent:requester", payload: explicitPayload() });
        await createGcStopNotice(f.root, f.meshId, { endpointId: "root:other", payload: gcPayload() });
        assert.ok(first);
        assert.deepEqual((await listPendingTuiNotices(f.root, f.meshId, recipient)).map(item => item.noticeId), [first.noticeId]);
        assert.deepEqual((await listPendingTuiNotices(f.root, f.meshId, recipient)).map(item => item.noticeId), [first.noticeId]);
        await writeFile(join(f.notices, `${randomUUID()}.json`), "{}\n");
        assert.deepEqual((await listPendingTuiNotices(f.root, f.meshId, recipient)).map(item => item.noticeId), [first.noticeId]);
    } finally { await rm(f.root, { recursive: true, force: true }); }
});

// Given a pending notice, when display and acknowledgment cross the store boundary, repeated polls may return it before ack, recipient mismatch cannot ack it, and successful ack removes it from pending delivery.
void test("acknowledgment preserves at-least-once delivery semantics", async () => {
    const f = await fixture();
    try {
        const notice = await createGcStopNotice(f.root, f.meshId, { ...recipient, payload: gcPayload() });
        assert.equal((await listPendingTuiNotices(f.root, f.meshId, recipient)).length, 1);
        assert.equal((await listPendingTuiNotices(f.root, f.meshId, recipient)).length, 1);
        await assert.rejects(acknowledgeDisplayedTuiNotice(f.root, f.meshId, notice.noticeId, { endpointId: "root:different" }, displayedAt), /recipient endpoint/u);
        const acknowledged = await acknowledgeDisplayedTuiNotice(f.root, f.meshId, notice.noticeId, recipient, displayedAt);
        assert.equal(acknowledged.state, "acknowledged"); assert.ok(acknowledged.displayedAt); assert.ok(acknowledged.acknowledgedAt);
        assert.deepEqual(await listPendingTuiNotices(f.root, f.meshId, recipient), []);
        assert.equal((await acknowledgeDisplayedTuiNotice(f.root, f.meshId, notice.noticeId, recipient, displayedAt)).acknowledgedAt, acknowledged.acknowledgedAt);
    } finally { await rm(f.root, { recursive: true, force: true }); }
});

// Given a W3-valid 120-codepoint Japanese purpose, when an explicit stop notice is persisted and listed, the parent observes the same pending stop purpose with no silent truncation or rejection.
void test("explicit stop notice roundtrips a 120-codepoint Japanese purpose without silent loss", async () => {
    const f = await fixture();
    try {
        const purpose = "界".repeat(120);
        assert.equal(Array.from(purpose).length, 120);
        assert.ok(Buffer.byteLength(purpose, "utf8") > 120);
        const created = await createExplicitStopNotice(f.root, f.meshId, { ...recipient, requesterEndpointId: "agent:requester", payload: { ...explicitPayload(), purpose } });
        assert.ok(created?.kind === "explicit-stop");
        assert.equal(created.schemaVersion, TUI_NOTICE_SCHEMA_VERSION);
        assert.equal(created.payload.purpose, purpose);
        const persisted = JSON.parse(await readFile(join(f.notices, `${created.noticeId}.json`), "utf8")) as { schemaVersion: unknown; payload: { purpose?: string } };
        assert.equal(persisted.schemaVersion, TUI_NOTICE_SCHEMA_VERSION);
        assert.equal(persisted.payload.purpose, purpose);
        const reloaded = validateTuiNotice(persisted, { meshId: f.meshId, noticeId: created.noticeId });
        assert.ok(reloaded.kind === "explicit-stop");
        assert.equal(reloaded.schemaVersion, TUI_NOTICE_SCHEMA_VERSION);
        assert.equal(reloaded.payload.purpose, purpose);
        const pending = await listPendingTuiNotices(f.root, f.meshId, recipient);
        assert.equal(pending.length, 1);
        assert.ok(pending[0]?.kind === "explicit-stop");
        assert.equal(pending[0].payload.purpose, purpose);
        assert.equal(pending[0].noticeId, created.noticeId);
    } finally { await rm(f.root, { recursive: true, force: true }); }
});
