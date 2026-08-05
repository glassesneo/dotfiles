import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const helper = join(import.meta.dirname, "..", "extensions", "subagent", "return-parent.sh");
type Invocation = "binding-a" | "parent";

async function run(scenario: string, invocation: Invocation = "binding-a", viewingSession = "$view-a", hubSession = "$hub") {
    const root = await mkdtemp(join(tmpdir(), "return-parent-"));
    const log = join(root, "tmux.log");
    const tmux = join(root, "tmux");
    await writeFile(tmux, `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$LOG"
if [[ $1 == display-message && $2 == -p && $3 == -t ]]; then printf '@child\\n'; exit 0; fi
if [[ $1 == list-clients ]]; then
  printf '/dev/ttys001|$view-a|@child\\n'
  [[ $SCENARIO != two-viewers ]] || printf '/dev/ttys002|$view-b|@child\\n'
  exit 0
fi
if [[ $1 == display-message && $2 == -p && $3 == -c ]]; then
  client=$4
  session=$VIEWING_SESSION
  window=@child
  [[ $SCENARIO != stale-context ]] || session='$view-b'
  [[ $SCENARIO != missing-client ]] || exit 1
  parent_pid=10
  [[ $SCENARIO == pid-mismatch ]] && parent_pid=99
  printf '10|%s|%s|%s|1|%s|$parent|@parent|%s\\n' "$session" "$window" "$client" "$parent_pid" "$HUB_SESSION"
  exit 0
fi
if [[ $1 == has-session ]]; then [[ $SCENARIO != missing-parent ]] || exit 1; exit 0; fi
if [[ $1 == list-windows ]]; then printf '@other\\n@parent\\n'; exit 0; fi
if [[ $1 == select-window ]]; then [[ $SCENARIO != select-failure ]] || exit 1; exit 0; fi
if [[ $1 == switch-client ]]; then [[ $SCENARIO != switch-failure ]] || exit 1; exit 0; fi
if [[ $1 == unlink-window ]]; then [[ $SCENARIO != unlink-failure ]] || { printf 'unlink rejected\\n' >&2; exit 1; }; exit 0; fi
exit 0
`);
    await chmod(tmux, 0o755);
    const args = invocation === "binding-a" ? [helper, "--binding", "/dev/ttys001", viewingSession, "@child"] : [helper];
    const result = spawnSync("bash", args, {
        encoding: "utf8",
        env: { ...process.env, PATH: `${root}:${process.env.PATH ?? ""}`, LOG: log, SCENARIO: scenario, VIEWING_SESSION: viewingSession, HUB_SESSION: hubSession, TMUX_PANE: "%child" },
    });
    return { result, calls: await readFile(log, "utf8") };
}

void test("binding context switches and unlinks exactly the invoking client view when two clients view the child", async () => {
    const { result, calls } = await run("two-viewers");
    assert.equal(result.status, 0, result.stderr);
    assert.match(calls, /display-message -p -c \/dev\/ttys001/);
    assert.match(calls, /switch-client -c \/dev\/ttys001 -t \$parent/);
    assert.match(calls, /unlink-window -t \$view-a:@child/);
    assert.doesNotMatch(calls, /\/dev\/ttys002|\$view-b:@child/);
    assert.doesNotMatch(calls, /kill-window|kill-session/);
});

void test("binding fails before mutation if its explicit source context changed", async () => {
    const { result, calls } = await run("stale-context");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invocation context changed/);
    assert.doesNotMatch(calls, /select-window|switch-client|unlink-window/);
});

void test("/parent resolves its sole applicable client and returns that view", async () => {
    const { result, calls } = await run("success", "parent");
    assert.equal(result.status, 0, result.stderr);
    assert.match(calls, /list-clients/);
    assert.match(calls, /switch-client -c \/dev\/ttys001/);
    assert.match(calls, /unlink-window -t \$view-a:@child/);
});

void test("/parent fails without mutation when two clients view the child", async () => {
    const { result, calls } = await run("two-viewers", "parent");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exactly one client.*found 2/);
    assert.doesNotMatch(calls, /select-window|switch-client|unlink-window/);
});

void test("return helper preserves the owned hub link", async () => {
    const { result, calls } = await run("success", "binding-a", "$hub", "$hub");
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(calls, /unlink-window/);
});

for (const scenario of ["pid-mismatch", "missing-parent", "missing-client", "select-failure", "switch-failure"] as const) {
    void test(`return helper leaves the child linked on ${scenario}`, async () => {
        const { result, calls } = await run(scenario);
        assert.notEqual(result.status, 0);
        assert.doesNotMatch(calls, /unlink-window/);
    });
}

void test("unlink failure reports partial success without killing the child", async () => {
    const { result, calls } = await run("unlink-failure");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Returned to parent, but the subagent view could not be unlinked/);
    assert.match(calls, /switch-client/);
    assert.doesNotMatch(calls, /kill-window|kill-session/);
});
