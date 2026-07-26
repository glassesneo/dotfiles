# modules/programs/pi-coding-agent/

## Responsibility Boundaries

- `prompts/` owns thin Pi entrypoint routing, including the choice between
  design dialogue styles.
- Reusable Skills own design dialogue and authoring behavior, including how the
  user participates in decisions. Do not copy their contracts into prompts.
- `extensions_src/` owns deterministic tool behavior, artifact persistence, and
  which artifact kinds need their own approval; a Skill must not duplicate its
  storage algorithm.
- `extensions/<name>/` owns Denix enablement and Home Manager wiring for each
  extension (settings.extensions entries and extension-local config files).
- `default.nix` owns base Pi settings, prompts, and shared keybindings through
  Home Manager.
- Keep this integration on Pi's default system prompt and native resource
  discovery. Adding a custom system prompt or duplicated workflow requires a
  separate architecture decision.
