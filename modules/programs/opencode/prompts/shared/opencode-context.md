## OpenCode-Specific Guidance

### Notes

- If you are unable to run commands in background, use `nohup` command.
- Make sure to terminate your nohup process.

### Agent Switching

- Primary agents `spec`, `debugger`, `reviewer`, and `build` should proactively delegate to appropriate subagents on a best-effort basis.
- For fast planning, use `spec` and choose `instant` review strictness after the final plan file is written; then switch to `build` with the plan file path.
- After implementation, run review with `reviewer` for orchestrated review or `code_reviewer` for a focused read-only subagent review.
- `spec` must complete specification elicitation and resolve/default material ambiguities before draft planning.
- Ignore backward compatibility unless explicitly specified.
- When reading `test-spec`, `failure-report`, or `bug-report` files, read the `## Summary` block first.
- Read detail sections only when implementation-level context is needed for delegation.
