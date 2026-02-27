# DPP plugin data

Plugin data for DPP lives in `modules/config/dpp-shared.nix` as Nix attrsets.

## Plugin lists

- `editingPlugins` — editing utility plugins (nvim-only)
- `motionPlugins` — motion/search plugins (nvim-only)
- `skkPlugins` — SKK Japanese input plugins (nvim + vim)
- `ddcPlugins` — ddc.vim completion stack (vim-only)

## TOML generation

Each list is serialized to a TOML file (`editing.toml`, `motion.toml`, `skk.toml`, `ddc.toml`) using `pkgs.formats.toml.generate`. Nvim excludes `ddc.toml`; Vim includes all.

## Naming convention

- TOML files must match `^[a-z0-9-]+\.toml$` to be loaded by `dpp.ts`.
- The generated TOML name corresponds to the plugin list name in `dpp-shared.nix`.

## Exclusion/inclusion rules

- `nvim`: excludes ddc (controlled in `dpp-shared.nix` — `pluginTomlsNvim` omits `ddcToml`)
- `vim`: includes all (controlled in `dpp-shared.nix` — `pluginTomlsVim` includes `ddcToml`)
