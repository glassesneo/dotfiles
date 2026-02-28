# modules/toplevel/

## Secrets Management

- All shared secrets are declared in @modules/toplevel/secrets.nix and referenced as `config.sops.secrets.<key>.path`.
- Host default secret files are bound in @hosts/kurogane/secrets.nix.
- Use a dedicated SOPS age key only; do not reuse SSH keys or keys from unrelated workflows.
- **NEVER** hardcode secrets or plaintext values.
- Encrypted blobs live in host directories (currently `hosts/kurogane/secrets.yaml`).
- Rotation runbook: @docs/secrets-key-rotation.md
