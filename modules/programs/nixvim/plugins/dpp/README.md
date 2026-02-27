# DPP ownership boundaries

This module keeps plugin declaration, compile, and runtime loading concerns intentionally separated.

## Ownership model

- Nix owns plugin data, TOML generation, and Home Manager wiring:
  - `modules/config/dpp-shared.nix` (plugin data as Nix attrsets, TOML generation, duplicate-repo guard)
  - `modules/programs/nixvim/plugins/dpp/default.nix` (Neovim bootstrap, env wiring, config deploy)
  - `modules/programs/vim/default.nix` (Vim bootstrap, env wiring, config deploy)
- TypeScript owns runtime TOML loading via glob discovery:
  - `modules/programs/nixvim/plugins/dpp/dpp.ts`

## Data flow

1. Define plugin specs as Nix attrsets in `modules/config/dpp-shared.nix` (`editingPlugins`, `motionPlugins`, `skkPlugins`, `ddcPlugins`).
2. `pkgs.formats.toml.generate` converts each list to a TOML derivation.
3. Derivations are combined into an output directory with duplicate-repo validation.
4. Load generated TOML at runtime in `dpp.ts` using filename-based glob discovery from the config plugin dir.

## Practical rule

- Put plugin metadata and plugin lists in `modules/config/dpp-shared.nix` (Nix attrsets).
- Put export/wiring behavior in Nix (`dpp-shared.nix`, `default.nix`).
- Put runtime loader behavior in TypeScript.
