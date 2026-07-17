# modules/programs/claude-code/

## Agent Source of Truth

`prompts/*.md` owns global agent prompt behavior, `default.nix` owns metadata,
wiring, settings, and permissions, and `GLOBAL_CLAUDE.md` owns global runtime
memory. Keep each rule at the layer that consumes it.

Project-local `.claude/agents/` definitions can override or shadow these global agents.

## Tester Artifacts

The `tester` subagent writes non-trivial failure reports to `.agents/failure-reports/` only when the current workspace is a git repo. Outside git repos, it returns structured failure content inline.
