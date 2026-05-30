## OpenCode-Specific Guidance

### Notes

- If you are unable to run commands in background, use `nohup` command.
- Make sure to terminate your nohup process.

### Agent Switching

- Ignore backward compatibility unless explicitly specified.
- When reading `test-spec`, `failure-report`, or `bug-report` files, read the `## Summary` block first.
- Read detail sections only when implementation-level context is needed for delegation.

### Local File Exploration

- For local repository or filesystem exploration, all primary agents and subagents should delegate to `explore` before drawing conclusions from file context.
- Nested subagent calls are allowed for this purpose: subagents should call `explore` directly when they need additional local file context.
- The `explore` agent itself should perform the requested read-only exploration directly instead of recursively delegating to `explore`.
