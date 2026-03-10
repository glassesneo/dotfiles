# modules/programs/claude-code/

## Agent Source of Truth

Global Claude Code agent behavior is defined in two files in this directory:

- `default.nix` — agent definitions (`internet-research`, `code_reviewer`, `tester`) under `programs.claude-code.agents`, plus settings and permissions.
- `GLOBAL_CLAUDE.md` — global memory injected via `programs.claude-code.memory.text`; contains tool usage rules and proactive delegation guidance.

Project-local `.claude/agents/` definitions can override or shadow these global agents.

## Tester Artifacts

The `tester` subagent writes non-trivial failure reports to `.agents/reports/` only when the current workspace is a git repo. Outside git repos, it returns structured failure content inline without creating report files.