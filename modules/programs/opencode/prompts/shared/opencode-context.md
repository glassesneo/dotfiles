## OpenCode-Specific Guidance

### Notes

- If you are unable to run commands in background, use `nohup` command.
- Make sure to terminate your nohup process.

### Agent Switching

- Ignore backward compatibility unless explicitly specified.
- When reading `test-spec`, `failure-report`, or `bug-report` files, read the `## Summary` block first.
- Read detail sections only when implementation-level context is needed for delegation.
