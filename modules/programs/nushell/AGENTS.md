# modules/programs/nushell/

## Local Contract

- Keep `config.nu` minimal; the Nix module owns loaded configuration.
- Keep `env.nu` empty; Nix `extraEnv` owns environment setup.
- Nix owns plugin binaries, completion loading, environment injection, and XDG deployment; do not duplicate that wiring in Nushell source files.
- Keep SketchyBar completions in the qualified `"sketchybar extern" *` namespace to avoid collisions. Locally authored API modules intentionally export their commands unqualified.
- API credentials are environment inputs supplied by the Nix/secret owner; never embed them in `.nu` files.
