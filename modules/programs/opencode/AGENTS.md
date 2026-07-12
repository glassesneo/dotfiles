# modules/programs/opencode/

## Prompt Ownership Policy

- Command templates under `prompts/commands/*.md` are runtime prompts sent to the model for a specific user entrypoint.
- Agent prompts under `prompts/*.md` are reusable role and behavior instructions for OpenCode agents.
- `prompts/shared/*.md` contains OpenCode-local shared prompt fragments and context snippets that do not have an external canonical owner.
- `agent-reports` is the canonical source for implementation, review, bug, and failure report formats and filename policy. OpenCode prompts should load that skill when creating durable reports rather than injecting local duplicate schemas.
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

- Commands are explicit user entrypoints. The staged workflow commands are thin target/profile adapters to `staged-agent-workflow`; that skill owns reusable phase gates and capability behavior.
- Agent prompts under `prompts/*.md` should stay thin and reusable. They define general capability posture only: whether the agent may write source, what broad class of work it performs, where it may place generic artifacts, and when delegation is appropriate.
- Do not duplicate staged workflow knowledge in reusable agent prompts or command adapters. Consumer wiring maps capability names to local agents without making the reusable skill OpenCode-specific.
- Report-producing prompts load `agent-reports`; if it is unavailable, they report a blocker rather than inventing a local report schema.
- Subagents are autonomous delegation units. They should be invoked by another agent when they improve correctness, speed, or risk control; users do not need to enter command syntax for delegation.
- Review inspection is owned by `review-orchestrator`: it scales focused `focused-reviewer` delegations by target size/risk, adapts perspectives from review intent and target risk, triages results, then asks `dissent-reviewer` to validate misses, overreach, severity, and alternate interpretations.
- `taskmaster` is the general source-changing implementation capability. It receives approved local execution contracts from workflow primaries while remaining directly available as an intentional escape hatch.
- `scout` is the read-only workflow primary for staged commands and remains available directly for planning, teaching, ideation, or inspection.

## Architecture Change Boundary

- OpenCode is the runtime adapter and policy-enforcement layer. Reusable stage and approval behavior belongs to `staged-agent-workflow`; durable report schemas belong to `agent-reports`.
- `commands.nix` owns command registration and routing. Command prompts select a profile, provide the target, and map only the local capabilities that profile requires.
- `agents.nix` and `agent-permissions.nix` own local capability bindings and enforce read-only, source-changing, execution, and delegation boundaries. `default.nix` owns the OpenCode module interface and MCP membership.
- Model choices, descriptions, registry values, compatible capability mappings, narrower permission rules, and MCP membership are configuration changes when they preserve these ownership boundaries.
- Moving behavior between owners, making a workflow primary source-changing, introducing a local report schema, widening read-only agents through an implementation option, or changing a reusable profile's meaning is an architecture change.
- Before an architecture change, inspect the repository architecture guidance and every affected owner. Update the owning contract, consumers, assertions, and documentation together; do not perform an ownership move as an isolated prompt or Nix edit.
- Before any edit, identify the current owner and decide whether the request changes a value within its interface or changes the interface itself. If multiple layers would become authoritative, resolve the boundary before editing.
- Keep current mappings and concrete values in their registries and assertions rather than duplicating them here.
