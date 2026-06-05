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

- Commands are explicit user entrypoints. Command entries in `default.nix` route user entrypoints to agents; command templates under `prompts/commands/` own the user-facing workflow contract, including multi-file workflows, artifact hierarchy, phase gates, report formats, and command-specific delegation policy.
- Agent prompts under `prompts/*.md` should stay thin and reusable. They define general capability posture only: whether the agent may write source, what broad class of work it performs, where it may place generic artifacts, and when delegation is appropriate.
- Do not put slash-command-only workflow knowledge in reusable agent prompts. Spec→Plan→Implement ordering, spec/plan/report priority, command phase gates, and required command artifacts belong in the relevant command template such as `/spec` or `/impl`.
- Subagents are autonomous delegation units. They should be invoked by another agent when they improve correctness, speed, or risk control; users do not need to enter command syntax for delegation.
- Review/debug inspection is owned by `inspector`: `/review`, `/primary-review`, and `/debug` are command-owned user entrypoints routed through `inspector`, which loads concise skills and delegates strict code-review viewpoints to `reviewer1`/`reviewer2`.
- `taskmaster` is the general source-changing agent. `/act` adds a lightweight plan → approval → execute workflow for smaller tasks; `/impl` adds the implementation workflow contract when that command routes to `taskmaster`.
- `scout` is the general non-source-writing agent. `/spec`, `/sensei`, and `/idea` add their own workflow contracts when those commands route to `scout`; its permissions are scoped for `.agents/` artifacts plus `/tmp` or `/private/tmp` diagnostic sandboxes.
- `/sensei` is the supported explanation entrypoint for teaching reports and git revisions/ranges to project outsiders.
- `/idea` is the supported early ideation entrypoint for conversational problem framing before planning.
