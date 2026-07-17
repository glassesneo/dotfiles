# SOPS Age Key Rotation Runbook

This runbook rotates one recipient key for the active shared encrypted blob,
`secrets/shared.yaml`, without changing secret values. The creation rule is in
`.sops.yaml`; `modules/toplevel/secrets.nix` declares the shared secrets and key
file locations.

Do not put plaintext credentials or private keys in the repository. Consumers
must use `config.sops.secrets.<key>.path`, never a hardcoded decrypted path.

## Bootstrap a host without an Age key

The repository imports the sops-nix platform module unconditionally because
Nix module imports cannot depend on host configuration. A host can still stop
all repository-owned secret provisioning while it has no usable Age key:

```nix
myconfig.toplevel.secrets = {
  enable = false;
  names = ["brave-api-key"];
};
```

Keep `names` limited to the credentials that the host should receive after
bootstrap. With `enable = false`, the configuration emits no SOPS key-file
setting, secret declarations, or shared secret paths. Programs that need those
credentials remain installed but their secret-backed operations are unavailable
until provisioning is restored.

Build and activate the host with its normal repository workflow. For example,
the initial `seiran-vm1` deployment can use:

```sh
sudo nix run nix-darwin/master#darwin-rebuild -- switch --flake .#seiran-vm1
```

Before restoring provisioning, install a usable private Age key outside the
repository at `~/.config/sops/age/keys.txt`, set its mode to `0600`, and confirm
its recipient is authorized for `secrets/shared.yaml`. Then set `enable = true`
(or remove the false override), run the normal switch workflow again, and verify
one declared secret path is readable without printing its contents. If
activation fails, disable provisioning again and fix the key or recipient
configuration before retrying.

## Prerequisites

- `age`, `age-keygen`, and `sops` are installed.
- You have the old private key and all private keys needed to decrypt the shared
  blob.
- You know which old recipient in the `secrets/shared.yaml` creation rule is
  being replaced. Preserve recipients belonging to other active machines.
- The working tree changes to `.sops.yaml` and `secrets/shared.yaml` can be
  reviewed before deployment.

## Rotate a recipient

1. Back up the old private key securely, then generate the replacement at the
   key-file path used by the target machine. On Darwin that path is
   `~/.config/sops/age/keys.txt`; on NixOS it is the same path under the user's
   home directory.

   ```sh
   install -d -m 700 "$HOME/.config/sops/age"
   age-keygen -o "$HOME/.config/sops/age/keys.txt.new"
   chmod 600 "$HOME/.config/sops/age/keys.txt.new"
   NEW_RECIPIENT="$(age-keygen -y "$HOME/.config/sops/age/keys.txt.new")"
   printf '%s\n' "$NEW_RECIPIENT"
   ```

2. In `.sops.yaml`, replace only the retiring recipient in the
   `^secrets/shared\.yaml$` rule. Do not remove other active recipients.

3. Rewrap the shared blob while both old and new private keys are available.
   `CURRENT_KEYS` must contain every key needed to decrypt the current blob.

   ```sh
   CURRENT_KEYS="<path-to-current-decryption-keys>"
   COMBINED_KEYS="$(mktemp)"
   trap 'rm -f "$COMBINED_KEYS"' EXIT
   chmod 600 "$COMBINED_KEYS"
   cp "$CURRENT_KEYS" "$COMBINED_KEYS"
   cat "$HOME/.config/sops/age/keys.txt.new" >> "$COMBINED_KEYS"
   SOPS_AGE_KEY_FILE="$COMBINED_KEYS" sops updatekeys -y secrets/shared.yaml
   ```

4. Validate before replacing the active key:

   ```sh
   SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt.new" \
     sops decrypt secrets/shared.yaml >/dev/null
   sops filestatus secrets/shared.yaml
   nix flake check
   ```

   Review the encrypted diff. Secret values must not appear in command output or
   the diff, and the retired recipient must be absent from both `.sops.yaml` and
   the SOPS metadata in `secrets/shared.yaml`.

5. Install the replacement key on the target machine and deploy:

   ```sh
   mv "$HOME/.config/sops/age/keys.txt.new" \
     "$HOME/.config/sops/age/keys.txt"
   chmod 600 "$HOME/.config/sops/age/keys.txt"
   ```

   Run the appropriate repository switch workflow, then verify a consumer can
   read its declared `config.sops.secrets.<key>.path` without printing its
   contents. Remove the old active key only after this succeeds.

## Rollback

Before deleting the old key, restore the previous `.sops.yaml` recipient list
and re-run `sops updatekeys -y secrets/shared.yaml` with keys capable of
decrypting the current blob. Restore the old key file on the target machine and
redeploy. If the old key has already been removed, recover it from the secure
backup before rewrapping.

## Host-specific policy entries

`.sops.yaml` also contains a creation rule for `secrets/seiran.yaml`, but that
encrypted file does not currently exist and is not referenced by
`modules/toplevel/secrets.nix`. Treat the entry as reserved policy, not an active
secret blob. If host-specific secrets are added in the future, assign every
intended recipient to the matching `.sops.yaml` rule before creating the
encrypted file; the Seiran placeholder currently has no recipients and is not
usable as-is. Give the encrypted file and declaration a clear owner, and update
this runbook only when the active rotation model changes.
