# modules/toplevel/

## Secrets Management

- All shared secrets are declared in @modules/toplevel/secrets.nix and referenced as `config.sops.secrets.<key>.path`.
- Host-specific secret bindings, when present, live in `hosts/<name>/secrets.nix`.
- Use a dedicated SOPS age key only; do not reuse SSH keys or keys from unrelated workflows.
- **NEVER** hardcode secrets or plaintext values.
- Exact encrypted blob paths belong in the rotation runbook, not this entry guide.
- Rotation runbook: @docs/secrets-key-rotation.md

## nix-darwin Module Ownership

- `nix-darwin/system/` — shared OS/system policy only: activation glue, host identity, security, and central IME aggregation.
- `nix-darwin/preferences/` — shared macOS user preferences (appearance, dock, input, files, etc.).
- `nix-darwin/preferences/accessibility/` — accessibility-specific preference modules (zoom).
- Feature modules (e.g. `programs/aquaskk`) own their own darwin-specific settings and contribute to central aggregation interfaces (e.g. `nix-darwin.system.ime.extraEnabledInputSources`) rather than hardcoding entries in system modules.
