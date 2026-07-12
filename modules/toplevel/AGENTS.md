# modules/toplevel/

## Secrets

- `secrets.nix` owns shared secret declarations; consumers use `config.sops.secrets.<key>.path`.
- Host-specific declarations, if introduced, belong to the host owner rather than this shared module.
- Operational key and encrypted-source details belong in `docs/secrets-key-rotation.md`.

## Aggregation Ownership

- Toplevel modules own broad system/user aggregation and shared upstream integrations, not feature-local behavior.
- Feature modules own their Darwin-specific policy and contribute through typed aggregation interfaces instead of writing centralized system lists directly.
- Shared Catppuccin Home Manager import and global integration belong here; feature and rice modules select typed theme policy without importing the upstream module.
