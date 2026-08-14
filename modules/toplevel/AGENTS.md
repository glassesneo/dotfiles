# modules/toplevel/

## Secrets

- `secrets.nix` owns shared secret declarations; consumers use `config.sops.secrets.<key>.path`.
- Host-specific declarations, if introduced, belong to the host owner rather than this shared module.
- Operational key and encrypted-source details belong in `docs/secrets-key-rotation.md`.

## Adapter and Integration Ownership

- Keep only module-system adapters and genuinely cross-cutting final integration in this subtree.
- Put concern policy and subsystem-local aggregation with the owner defined by `docs/denix-architecture.md`.
