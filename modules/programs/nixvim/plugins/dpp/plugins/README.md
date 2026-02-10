# DPP plugin file discovery

This directory is auto-discovered by both Nix generation and DPP TypeScript loading.

## Naming convention

- Source Nickel files must match `^[a-z0-9-]+\.ncl$` to be exported.
- Generated TOML files must match `^[a-z0-9-]+\.toml$` to be loaded.
- The generated TOML name is derived from the source Nickel name (`<name>.ncl -> <name>.toml`).
- TOML files are generated artifacts from Nickel and can be local/untracked.

## Explicit exclusions

- `plugins_contract.ncl` is always excluded from plugin export.
- Add non-plugin fixtures/scratch files to explicit exclusion lists in:
  - `modules/programs/nixvim/plugins/dpp/default.nix`
  - `modules/programs/nixvim/plugins/dpp/regenerate-toml.sh`
  - `modules/programs/nixvim/plugins/dpp/dpp.ts` (for TOML loading)

## Warning

If a scratch or temporary file matches the discovery regex, it is treated as a real plugin definition and will be exported/loaded automatically.
