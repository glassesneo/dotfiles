# modules/programs/opencode/

## Agent Source of Truth

- `prompts/*.md` contains runtime prompt content for reusable OpenCode agents in this module.
- `prompts/shared/*.md` contains canonical shared prompt fragments, contracts, policies, and context snippets.
- `default.nix` owns agent metadata, permissions, shared fragment loading, placeholder rendering/wiring, and command-specific runtime instructions.
- Permission presets in `default.nix` are organized under `perm.*` by concern; compose new agent permissions from read/write, execute, delegate, interact, network, context, safety, and scope helpers instead of hand-building ad hoc bundles.
- Keep explanatory notes about this dotfiles module in this file; keep instructions that should be shown to OpenCode agents in `prompts/*.md` or command templates.

## Local Agents

- Commands are explicit user entrypoints. Command templates in `default.nix` own the user-facing workflow contract and route to the agent that should execute it.
- Subagents are autonomous delegation units. They should be invoked by another agent when they improve correctness, speed, or risk control; users do not need to enter command syntax for delegation.
- Review intentionally exists both as `/review` and `reviewer`: `/review` and `/primary-review` are user entrypoints routed through `scout`, while `reviewer` is the autonomous subagent for orchestrated review delegation.
- `taskmaster` handles implementation-oriented command workflows such as `/impl`, including source edits, validation, triage, and post-implementation review delegation.
- `scout` handles read/report command workflows such as `/review` and `/primary-review`; it must not modify source, configuration, tests, or lockfiles.
- `spec` remains the primary planning agent, and `sensei` remains the primary explanation agent for teaching reports and git revisions/ranges to project outsiders.
- `idea` is currently disabled/commented out in `default.nix`; keep `prompts/idea.md` available for a later redesign.

