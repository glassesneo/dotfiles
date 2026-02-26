# sops-nix Secrets Management

This directory stores host-level encrypted secrets using `sops` and `sops-nix`.

## Layout

- `secrets/kurogane.yaml`: encrypted source of truth for host `kurogane`
- `.sops.yaml`: encryption rules for `secrets/kurogane.yaml`
- `hosts/kurogane/secrets.nix`: host binding for `sops.defaultSopsFile`
- `modules/toplevel/secrets.nix`: shared `sops.secrets.*` declarations

Dedicated secrets that belong to a single owner module are declared in that module (for example, INIAD credentials in `modules/programs/nushell/default.nix`).

## Bootstrap (one-time per machine)

```bash
mkdir -p "$HOME/Library/Application Support/sops/age"
ssh-to-age -private-key -i ~/.ssh/id_agenix -o "$HOME/Library/Application Support/sops/age/keys.txt"
```

Verification:

```bash
SOPS_AGE_KEY_FILE="$HOME/Library/Application Support/sops/age/keys.txt" \
  sops decrypt --extract '["brave-api-key"]' secrets/kurogane.yaml
```

## Editing Secrets

Update an existing key:

```bash
SOPS_AGE_KEY_FILE="$HOME/Library/Application Support/sops/age/keys.txt" \
  sops edit secrets/kurogane.yaml
```

Add a new key:

1. Add `<key>: <value>` to `secrets/kurogane.yaml` via `sops edit`.
2. Declare it in either:
   - `modules/toplevel/secrets.nix` (shared/multi-consumer), or
   - the owning module (single-consumer).
3. Consume it through `config.sops.secrets.<key>.path`.

## Runtime Consumption

- Preferred: read file paths directly from `config.sops.secrets.<name>.path`
- For env-var-only tools: use per-tool wrappers that export env vars from secret files before `exec`
- Do not use global bulk exports of secrets

## Validation

```bash
nix flake check
nh darwin switch . -H kurogane -Lt --dry
```
