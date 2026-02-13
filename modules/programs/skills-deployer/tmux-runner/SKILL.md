---
name: tmux-runner
description: Run long-running or high-output commands in tmux panes. Use for build commands, package updates, AI coding tasks (codex, aider), test suites. Supports creating new panes with auto-cleanup and sending to existing panes. Say "run in pane", "send to pane" to trigger.
allowed-tools: Bash(tmux:*), Bash(sleep)
---

# Tmux Runner

## Commands

Check panes:
```bash
tmux list-panes -F '#{pane_index}: #{pane_width}x#{pane_height}'
```

Send to existing pane:
```bash
tmux send-keys -t <pane> '<command>' && sleep 0.1 && tmux send-keys -t <pane> Enter
```

Create new pane (auto-closes on success):
```bash
tmux split-window -h '<command> && exit || read'
```

Options: `-h` right, `-v` below, `-p 40` size %

## Procedure

1. `tmux list-panes` to check existing panes
2. Existing pane → `send-keys -t <pane>`
3. New pane → `split-window` (prefer `-h`, use `-v` if narrow)

## Critical Notes

**ALWAYS send Enter separately with 0.1s delay:**
```bash
tmux send-keys -t 1 'codex "hello"' && sleep 0.1 && tmux send-keys -t 1 Enter
```
**Interactive sessions workflow:**
1. Create pane: `tmux split-window -h -p 50`
2. Send command: `tmux send-keys -t 1 'codex "msg"' && sleep 0.1 && tmux send-keys -t 1 Enter`
3. Wait: `sleep 3-5`
4. Capture: `tmux capture-pane -t 1 -p | tail -20`
