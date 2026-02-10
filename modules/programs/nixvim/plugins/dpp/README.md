# DPP ownership boundaries

This module keeps plugin declaration, compile, and runtime loading concerns intentionally separated.

## Ownership model

- Nickel owns the plugin data model and validation contract:
  - `modules/programs/nixvim/plugins/dpp/plugins/*.ncl`
  - `modules/programs/nixvim/plugins/dpp/plugins/plugins_contract.ncl`
- Nix owns compilation from Nickel to TOML and Home Manager wiring:
  - `modules/programs/nixvim/plugins/dpp/default.nix`
  - `modules/programs/nixvim/plugins/dpp/regenerate-toml.sh` (manual regen helper)
- TypeScript owns runtime TOML loading via glob discovery:
  - `modules/programs/nixvim/plugins/dpp/dpp.ts`

## Data flow

1. Define plugin specs in Nickel (`*.ncl`).
2. Compile to TOML (`*.toml`) through Nix build/export.
3. Load generated TOML at runtime in `dpp.ts` using filename-based glob discovery from the config plugin dir.

Generated TOML files are build/runtime artifacts derived from Nickel. They may be local or untracked and are not required committed snapshots.

## Practical rule

- Put plugin metadata and plugin lists in Nickel.
- Put export/wiring behavior in Nix.
- Put runtime loader behavior in TypeScript.
