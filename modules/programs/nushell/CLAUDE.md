# modules/programs/nushell/

## Overview

Nushell configuration with custom plugins, completions, and API integrations. Enabled by default.

## Architecture

- `config.nu` is minimal (3 lines) — real configuration lives in `default.nix` (Nix controls what loads).
- `env.nu` is empty — environment setup delegated to Nix `extraEnv`.
- Plugin binaries (`gstat`, `query`) injected into `$PATH` by Nix, not manually in config.
- 19 completions auto-imported from `nu_scripts` via `concatMapStrings`.
- Files deployed to `~/.config/nushell/` via XDG config.

## Custom Modules

- **`plugins/iniad.nu`**: INIAD campus IoT API client (room sensors, locker, IC card management). Auth: `$env.INIAD_ID`, `$env.INIAD_PASSWORD`.
- **`plugins/ai_mop.nu`**: Unified AI API client for OpenAI/Anthropic via INIAD proxy. Auth: `$env.AI_MOP_API_KEY`. Chat functions accept stdin for message content.
- **`completions/sketchybar.nu`**: Rich CLI completions for SketchyBar. Dynamically queries running SketchyBar instance for item/event names.

## Key Detail

SketchyBar completions are loaded with qualified namespace (`"sketchybar extern" *`) to prevent naming collisions. INIAD and AI MOP plugins are unqualified (exported directly).
