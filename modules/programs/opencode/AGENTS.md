# modules/programs/opencode/

## Prompt Ownership Policy

- Command templates under `prompts/commands/*.md` are runtime prompts sent to the model for a specific user entrypoint.
- Agent prompts under `prompts/*.md` are reusable role and behavior instructions for OpenCode agents.
- `prompts/shared/*.md` contains canonical shared prompt fragments, contracts, policies, and context snippets.
- OpenCode runtime report contracts live in `prompts/shared/*-report-format.md` and are injected into the prompts that need them. External skills such as `agent-reports` may carry their own reusable report guidance and references, but they are not the source of truth for OpenCode prompt expansion.
- The `programs.opencode` Denix module owns command and agent metadata, routing, permissions, shared fragment loading, placeholder rendering, descriptions, and other OpenCode configuration mechanics.
- Command descriptions and agent descriptions are UI/tool-selection metadata; keep them concise and do not rely on them for runtime behavior.
- Rules and guidance files such as this one are also LLM context, so keep them actionable and avoid duplicating large external documentation excerpts.
- Keep model/harness separation explicit: slash commands are user-facing harness entrypoints, and the model only sees the expanded prompt for the command that fired. Runtime prompts must not explain the slash-command surface, list slash-command names, or describe command routing as if the model can see other slash commands.
- Keep only task behavior the model needs inside runtime prompts. Put slash-command mechanics, command routing, `default_agent`, config schema, file-organization explanations, and UI metadata guidance in the OpenCode configuration layer or this file instead.
- Put tool-access prohibitions and hard safety boundaries in the `programs.opencode` permission presets. Runtime prompts should describe role intent, allowed artifact destinations, and workflow constraints that permissions cannot express; avoid restating detailed permission-enforced bans in prompt prose.
- Permission presets are organized under `perm.*` by concern; compose new agent permissions from read/write, execute, delegate, interact, network, context, safety, and scope helpers instead of hand-building ad hoc bundles.
- Keep explanatory notes about this dotfiles module in this file; keep instructions that should be shown to OpenCode agents in agent prompts or command templates.
- Do not copy full report, spec, or plan templates into this file. Point maintainers to the owning runtime prompt fragment or external skill reference instead.

## Local Agents

- Commands are explicit user entrypoints. The OpenCode configuration layer routes user entrypoints to agents; command templates under `prompts/commands/` own the user-facing workflow contract, including multi-file workflows, artifact hierarchy, phase gates, report formats, and command-specific delegation policy.
- Agent prompts under `prompts/*.md` should stay thin and reusable. They define general capability posture only: whether the agent may write source, what broad class of work it performs, where it may place generic artifacts, and when delegation is appropriate.
- Do not put command-only workflow knowledge in reusable agent prompts. Spec→Plan→Implement ordering, spec/plan/report priority, command phase gates, and required command artifacts belong in the relevant command template.
- Do not instruct an OpenCode agent to load `agent-reports` merely to obtain a report schema when the schema is already injected through `prompts/shared/`. Only mention an external skill when that workflow deliberately requires skill-specific behavior outside the runtime prompt contract.
- Subagents are autonomous delegation units. They should be invoked by another agent when they improve correctness, speed, or risk control; users do not need to enter command syntax for delegation.
- Review inspection is owned by `review-orchestrator`: it scales focused `focused-reviewer` delegations by target size/risk, adapts perspectives from review intent and target risk, triages results, then asks `dissent-reviewer` to validate misses, overreach, severity, and alternate interpretations.
- `taskmaster` is the general source-changing agent. Command templates may add approval gates, implementation reporting, or other workflow contracts when routed to it.
- `scout` is the general non-source-writing agent. Command templates may add planning, teaching, ideation, or inspection workflow contracts when routed to it.
