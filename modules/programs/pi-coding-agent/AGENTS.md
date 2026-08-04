# modules/programs/pi-coding-agent/

## Responsibility Boundaries

- `prompts/` owns thin Pi entrypoint routing, including design-dialogue choice
  and post-approval implementation/review entrypoints.
- Reusable Skills own design dialogue, implementation, validation, review, and
  composition procedures. Do not copy their contracts into prompts.
- `extensions_src/` owns deterministic tool behavior, artifact persistence, and
  which artifact kinds need their own approval; a Skill must not duplicate its
  storage algorithm.
- `extensions/profile/default.nix` and `extensions_src/profile.ts` own profile
  configuration and runtime control. A profile is a stable, command-independent
  capability: prompt templates and routes may select it and add a mode,
  artifact, or perspective, but its general behavior must not depend on slash
  command invocation. Profile-specific extension policy belongs under an
  owner-registered `profiles.<name>.extensions.<facet>` object.
- `extensions/<name>/` owns Denix enablement, facet registration and validation,
  and Home Manager wiring for each optional extension. Facet owners register
  even while disabled so shared profile definitions remain valid but inert.
- `default.nix` owns base Pi settings, prompts, and the ordered
  `defaultExtensions` aggregation. Entries are names relative to
  `programs.pi-coding-agent`; it resolves those modules and emits their
  `extensionPaths` before optional extension contributions.
- `keybindings/default.nix` is the aggregation owner and sole final writer for
  Pi-native and repository extension keybindings. Feature modules own their
  action/context contributions. Repository-owned defaults do not use
  Option/Alt; user overrides may use Pi-supported `alt` bindings.
- Keep this integration on Pi's default system prompt and native resource
  discovery. Adding a custom system prompt or duplicated workflow requires a
  separate architecture decision.
