import assert from "node:assert/strict";
import test from "node:test";
import {
    isTmuxPaneAlive,
    killTmuxPane,
    launchTmuxWindow,
    moveTmuxClientToRun,
    probeTmux,
    type CommandExecutor,
    type CommandResult,
} from "../extensions_src/utilities/subagent_tmux.ts";

function result(stdout = "", stderr = "", code = 0): CommandResult {
    return { stdout, stderr, code };
}

test("probe requires TMUX and accepts only a successful complete context", async () => {
    let calls = 0;
    const exec: CommandExecutor = async (command, args) => {
        calls += 1;
        assert.equal(command, "tmux");
        assert.deepEqual(args, ["display-message", "-p", "#{session_id}\t#{session_name}\t#{pane_id}"]);
        return result("$3\twork\t%9\n");
    };

    assert.equal(await probeTmux(exec, {}), null);
    assert.equal(calls, 0);
    assert.deepEqual(await probeTmux(exec, { TMUX: "/tmp/tmux,1,0" }), {
        sessionId: "$3", session: "work", paneId: "%9",
    });
    assert.equal(calls, 1);

    for (const malformed of ["", "$3", "$3\twork", "$3\t\t%9"]) {
        assert.equal(await probeTmux(async () => result(malformed), { TMUX: "yes" }), null);
    }
    assert.equal(await probeTmux(async () => result("ignored", "server unavailable", 1), { TMUX: "yes" }), null);
});

test("launch uses the owning session, enables remain-on-exit, and returns canonical IDs", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const exec: CommandExecutor = async (command, args) => {
        calls.push({ command, args: [...args] });
        return args[0] === "new-window" ? result("@7\t%11\n") : result();
    };

    const launched = await launchTmuxWindow(
        exec,
        { sessionId: "$3", session: "work", paneId: "%9" },
        { runId: "12345678-abcd-4abc-8abc-123456789abc", cwd: "/work tree", launcher: "/state/launch.sh" },
    );

    assert.deepEqual(calls, [
        {
            command: "tmux",
            args: [
                "new-window", "-d", "-P", "-F", "#{window_id}\t#{pane_id}",
                "-t", "$3:", "-c", "/work tree", "-n", "sa-12345678", "/state/launch.sh",
            ],
        },
        { command: "tmux", args: ["set-option", "-w", "-t", "@7", "remain-on-exit", "on"] },
    ]);
    assert.deepEqual(launched, {
        sessionId: "$3", session: "work", windowId: "@7", paneId: "%11", windowName: "sa-12345678",
    });
});

test("launch preserves tmux errors and rejects malformed IDs", async () => {
    await assert.rejects(
        launchTmuxWindow(
            async () => result("", "tmux refused launch\n", 1),
            { sessionId: "$1", session: "work", paneId: "%1" },
            { runId: "12345678", cwd: "/work", launcher: "/launch" },
        ),
        /tmux refused launch/,
    );
    await assert.rejects(
        launchTmuxWindow(
            async () => result("@1\n"),
            { sessionId: "$1", session: "work", paneId: "%1" },
            { runId: "12345678", cwd: "/work", launcher: "/launch" },
        ),
        /did not return window and pane IDs/,
    );
});

test("remain-on-exit failure cleans up the created window before reporting the error", async () => {
    const calls: string[][] = [];
    const exec: CommandExecutor = async (_command, args) => {
        calls.push([...args]);
        if (args[0] === "new-window") return result("@4\t%5\n");
        if (args[0] === "set-option") return result("", "option denied\n", 1);
        return result();
    };

    await assert.rejects(
        launchTmuxWindow(
            exec,
            { sessionId: "$1", session: "work", paneId: "%1" },
            { runId: "abcdef12", cwd: "/work", launcher: "/launch" },
        ),
        /option denied/,
    );
    assert.deepEqual(calls.at(-1), ["kill-window", "-t", "@4"]);
});

test("tmux client move validates session and pane before selecting the run window", async () => {
    const calls: string[][] = [];
    const exec: CommandExecutor = async (_command, args) => { calls.push([...args]); return args.includes("#{pane_dead}") ? result("0\n") : result(); };
    const target = { sessionId: "$1", session: "main", windowId: "@7", paneId: "%8", windowName: "sa-run" };
    await moveTmuxClientToRun(exec, { sessionId: "$1", session: "main", paneId: "%1" }, target);
    assert.deepEqual(calls, [
        ["display-message", "-p", "-t", "%8", "#{pane_dead}"],
        ["select-window", "-t", "@7"],
    ]);
    await assert.rejects(moveTmuxClientToRun(exec, { sessionId: "$2", session: "other", paneId: "%2" }, target), /unavailable tmux session/);
    await assert.rejects(moveTmuxClientToRun(async () => result("1\n"), { sessionId: "$1", session: "main", paneId: "%1" }, target), /no longer live/);
});

test("pane probes and kills distinguish dead, disappeared, and unexpected failures", async () => {
    const probeCalls: string[][] = [];
    const probe = (value: CommandResult): CommandExecutor => async (command, args) => {
        assert.equal(command, "tmux");
        probeCalls.push([...args]);
        return value;
    };
    assert.equal(await isTmuxPaneAlive(probe(result("0\n")), "%2"), true);
    assert.equal(await isTmuxPaneAlive(probe(result("1\n")), "%2"), false);
    assert.equal(await isTmuxPaneAlive(probe(result("", "can't find pane", 1)), "%2"), false);
    assert.deepEqual(probeCalls[0], ["display-message", "-p", "-t", "%2", "#{pane_dead}"]);

    await killTmuxPane(async (_command, args) => {
        assert.deepEqual(args, ["kill-pane", "-t", "%2"]);
        return result("", "can't find pane: %2", 1);
    }, "%2");
    await killTmuxPane(async () => result("", "no such pane: %2", 1), "%2");
    await assert.rejects(killTmuxPane(async () => result("", "permission denied\n", 1), "%2"), /permission denied/);
    await assert.rejects(killTmuxPane(async () => result("", "", 1), "%2"), /Could not kill tmux pane %2/);
});
