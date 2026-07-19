# modules/programs/pi-coding-agent/

## Responsibility Boundaries

- `prompts/` owns thin Pi entrypoint routing and links authoring phases when a
  workflow spans more than one artifact.
- Reusable Skills own specification and planning behavior, including candidate
  approval boundaries. Do not copy their authoring contracts into prompts.
- `extensions_src/` owns deterministic tool behavior and artifact persistence; a
  Skill must not duplicate its storage algorithm.
- `extensions/<name>/` owns Denix enablement and Home Manager wiring for each
  extension (settings.extensions entries and extension-local config files).
- `default.nix` owns base Pi settings, prompts, and shared keybindings through
  Home Manager.
- Keep this integration on Pi's default system prompt and native resource
  discovery. Adding a custom system prompt or duplicated workflow requires a
  separate architecture decision.
