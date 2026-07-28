# modules/programs/pi-coding-agent/

## Responsibility Boundaries

- `prompts/` owns thin Pi entrypoint routing, including the choice between
  design dialogue styles.
- Reusable Skills own design dialogue and authoring behavior, including how the
  user participates in decisions. Do not copy their contracts into prompts.
- `extensions_src/` owns deterministic tool behavior, artifact persistence, and
  which artifact kinds need their own approval; a Skill must not duplicate its
  storage algorithm.
- `extensions/profile/default.nix` and `extensions_src/profile.ts` own profile
  configuration and runtime control. Profile-specific extension policy belongs
  under an owner-registered `profiles.<name>.extensions.<facet>` object.
- `extensions/<name>/` owns Denix enablement, facet registration and validation,
  and Home Manager wiring for each optional extension. Facet owners register
  even while disabled so shared profile definitions remain valid but inert.
- `default.nix` owns base Pi settings, prompts, shared keybindings, and the
  ordered `defaultExtensions` aggregation. Entries are names relative to
  `programs.pi-coding-agent`; it resolves those modules and emits their
  `extensionPaths` before optional extension contributions.
- Keep this integration on Pi's default system prompt and native resource
  discovery. Adding a custom system prompt or duplicated workflow requires a
  separate architecture decision.
