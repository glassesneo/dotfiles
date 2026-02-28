# SOPS Key Rotation Runbook (Immediate Cutover)

This runbook rotates the SOPS age key used by this repository without changing secret values.

## Prerequisites

- `age`, `age-keygen`, and `sops` are installed.
- Existing encrypted file is `hosts/kurogane/secrets.yaml`.
- Existing SOPS policy file is `.sops.yaml`.
- You can access the legacy key file path used before this migration.

## 1) Generate a new dedicated key

```sh
mkdir -p "$HOME/.config/sops/age"
chmod 700 "$HOME/.config/sops/age"
age-keygen -o "$HOME/.config/sops/age/keys.txt"
chmod 600 "$HOME/.config/sops/age/keys.txt"
NEW_RECIPIENT="$(age-keygen -y "$HOME/.config/sops/age/keys.txt")"
echo "$NEW_RECIPIENT"
```

## 2) Backup the legacy key (encrypted with new recipient)

```sh
OLD_KEY_FILE="<legacy-key-file-path>"
NEW_RECIPIENT="$(age-keygen -y "$HOME/.config/sops/age/keys.txt")"
BACKUP_FILE="$HOME/.config/sops/age/legacy-keys-$(date +%Y%m%d).txt.age"
age -r "$NEW_RECIPIENT" -o "$BACKUP_FILE" "$OLD_KEY_FILE"
echo "$BACKUP_FILE"
```

## 3) Replace recipient in SOPS policy

Update `.sops.yaml` to use `NEW_RECIPIENT` in `creation_rules`.

## 4) Rewrap secrets to new key only

Because the current file is still encrypted to the old key, use a temporary combined key file once:

```sh
OLD_KEY_FILE="<legacy-key-file-path>"
NEW_KEY_FILE="$HOME/.config/sops/age/keys.txt"
COMBINED_KEY_FILE="/tmp/sops-age-keys-combined.txt"

cat "$OLD_KEY_FILE" "$NEW_KEY_FILE" > "$COMBINED_KEY_FILE"
chmod 600 "$COMBINED_KEY_FILE"

SOPS_AGE_KEY_FILE="$COMBINED_KEY_FILE" sops updatekeys -y hosts/kurogane/secrets.yaml
SOPS_AGE_KEY_FILE="$COMBINED_KEY_FILE" sops rotate -i hosts/kurogane/secrets.yaml
rm "$COMBINED_KEY_FILE"
```

## 5) Validate

```sh
SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt" \
  sops decrypt --extract '["brave-api-key"]' hosts/kurogane/secrets.yaml

OLD_RECIPIENT="<legacy-recipient>"
rg -n "$OLD_RECIPIENT" .sops.yaml hosts/kurogane/secrets.yaml
```

Expected:

- Decrypt succeeds with `~/.config/sops/age/keys.txt`.
- Old recipient string does not appear in `.sops.yaml` or `hosts/kurogane/secrets.yaml`.

## 6) Remove legacy key from active use

```sh
OLD_KEY_FILE="<legacy-key-file-path>"
rm "$OLD_KEY_FILE"
```

## 7) Evaluate configuration

```sh
nh home switch --dry
nix flake check
```

## Rollback

If immediate cutover fails before legacy key deletion:

- Revert `.sops.yaml` recipient to old key and rerun `sops updatekeys`.

If legacy key was deleted:

1. Decrypt the backup using the new key:

```sh
BACKUP_FILE="$HOME/.config/sops/age/legacy-keys-$(date +%Y%m%d).txt.age"
age -d -i "$HOME/.config/sops/age/keys.txt" -o /tmp/legacy-keys.txt "$BACKUP_FILE"
```

2. Use `/tmp/legacy-keys.txt` as `SOPS_AGE_KEY_FILE` to recover/re-wrap as needed, then delete it:

```sh
rm /tmp/legacy-keys.txt
```
