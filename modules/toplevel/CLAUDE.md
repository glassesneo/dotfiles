# modules/toplevel/

## Secrets Management

- All secrets are encrypted via agenix and referenced as `config.age.secrets.<key>.path`.
- **NEVER** hardcode secrets anywhere; wire secrets in @hosts/kurogane/agenix.nix.
- Encrypted blobs live in: @secrets/
