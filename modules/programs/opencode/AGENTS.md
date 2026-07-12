# modules/programs/opencode/

## Prompt and Runtime Ownership

- `prompts/commands/*.md` owns model-visible behavior for specific user entrypoints; command adapters for staged work stay thin and delegate reusable phase behavior to `staged-agent-workflow`.
- Reusable agent prompts under `prompts/*.md` define capability posture, not command routing or duplicated workflows.
- `prompts/shared/*.md` owns only OpenCode-local fragments without an external canonical owner. Durable report schemas and filename policy belong to `agent-reports`.
- `commands.nix` owns command registration and routing. `agents.nix` and `agent-permissions.nix` own capability bindings and enforced tool boundaries. `default.nix` owns the module interface and MCP membership.

## Model/Harness Boundary

- Runtime prompts receive expanded model-visible input, not the surrounding slash-command surface. Keep routing, `default_agent`, configuration schema, and UI metadata out of runtime prompts.
- Put hard tool boundaries in permission presets. Compose presets by concern instead of duplicating detailed permission bans in prompt prose.
- Keep descriptions concise and selection-oriented; they are metadata, not a substitute for runtime instructions.

## Architecture Decisions

- OpenCode is a runtime adapter and policy-enforcement layer. Reusable approval-gated workflow behavior belongs to `staged-agent-workflow`.
- Changes to model choices, descriptions, registry values, compatible capability mappings, narrower permissions, or MCP membership are configuration changes when ownership boundaries remain intact.
- Moving behavior between owners, changing capability meaning, widening a read-only capability, or introducing a local report schema changes architecture and must update all affected owners and consumers together.
