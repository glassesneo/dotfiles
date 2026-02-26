# modules/toplevel/

## Secrets Management

- All shared secrets are declared in @modules/toplevel/secrets.nix and referenced as `config.sops.secrets.<key>.path`.
- Host default secret files are bound in @hosts/kurogane/secrets.nix.
- **NEVER** hardcode secrets or plaintext values.
- Encrypted blobs live in @secrets/ (currently `secrets/kurogane.yaml`).
