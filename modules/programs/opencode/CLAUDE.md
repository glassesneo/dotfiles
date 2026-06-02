# modules/programs/opencode/

## Prompt Ownership Policy

- Command templates under `prompts/commands/*.md` are runtime prompts sent to the model for a specific user entrypoint.
- Agent prompts under `prompts/*.md` are reusable role and behavior instructions for OpenCode agents.
- `prompts/shared/*.md` contains canonical shared prompt fragments, contracts, policies, and context snippets.
- `default.nix` owns command and agent metadata, routing, permissions, shared fragment loading, placeholder rendering, descriptions, and other OpenCode configuration mechanics.
- Command descriptions and agent descriptions are UI/tool-selection metadata; keep them concise and do not rely on them for runtime behavior.
- Rules and guidance files such as this one are also LLM context, so keep them actionable and avoid duplicating large external documentation excerpts.
- Keep only task behavior the model needs inside runtime prompts. Put slash-command mechanics, command routing, `default_agent`, config schema, file-organization explanations, and UI metadata guidance in `default.nix` comments/descriptions or this file instead.
- Put tool-access prohibitions and hard safety boundaries in `default.nix` permission presets. Runtime prompts should describe role intent, allowed artifact destinations, and workflow constraints that permissions cannot express; avoid restating detailed permission-enforced bans in prompt prose.
- Permission presets in `default.nix` are organized under `perm.*` by concern; compose new agent permissions from read/write, execute, delegate, interact, network, context, safety, and scope helpers instead of hand-building ad hoc bundles.
- Keep explanatory notes about this dotfiles module in this file; keep instructions that should be shown to OpenCode agents in agent prompts or command templates.

## Local Agents

- Commands are explicit user entrypoints. Command entries in `default.nix` route user entrypoints to agents; command templates under `prompts/commands/` own the user-facing workflow contract.
- Subagents are autonomous delegation units. They should be invoked by another agent when they improve correctness, speed, or risk control; users do not need to enter command syntax for delegation.
- Review intentionally exists both as `/review` and `reviewer`: `/review` and `/primary-review` are command-owned user entrypoints routed through `reviewer` with read/diff-only permissions; `reviewer` also serves autonomous review delegation.
- Debug intentionally exists both as `/debug` and `debugger`: `/debug` is a command-owned user entrypoint routed through `scout` with the debugger workflow in the command prompt, while `debugger` is the autonomous subagent for delegated bug investigation.
- `taskmaster` handles implementation-oriented command workflows such as `/impl`, including source edits, validation, triage, and post-implementation review delegation.
- `scout` handles non-source-writing planning/read/report/investigation command workflows such as `/spec`, `/sensei`, `/idea`, and `/debug`; its permissions are scoped for `.agents/` artifacts plus `/tmp` or `/private/tmp` diagnostic sandboxes.
- `/sensei` is the supported explanation entrypoint for teaching reports and git revisions/ranges to project outsiders.
- `/idea` is the supported early ideation entrypoint for conversational problem framing before planning.
