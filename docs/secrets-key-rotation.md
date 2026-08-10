# SOPS Age Key Rotation Runbook

This runbook rotates one Age recipient for the active shared encrypted blob,
`secrets/shared.yaml`, without changing secret values. The creation rule is in
`.sops.yaml`; `modules/toplevel/secrets.nix` owns the repository interface and
Home Manager secret declarations.

Home Manager is the only provisioner for these user secrets on both Darwin and
Linux. It reads the private key from `~/.config/sops/age/keys.txt`, decrypts into
the user's runtime directory, and exposes it through the stable symlink
`~/.config/sops-nix/secrets`. Runtime data can disappear at logout or reboot;
the sops-nix launchd agent or systemd user service recreates it at login.

Never print plaintext credentials or private keys. Do not display them with
`cat` or `head`, enable shell tracing, or copy decrypted output into logs.
Consumers must use `config.sops.secrets.<key>.path`, not a hardcoded decrypted
path.

## Bootstrap a host without an Age key

The sops-nix Home Manager module is imported unconditionally, but the repository
can disable all secret declarations while a host has no usable Age key:

```nix
myconfig.toplevel.secrets = {
  enable = false;
  entries = {
    brave-api-key = {};
  };
};
```

Keep `entries` limited to credentials that the host should receive after
bootstrap. With `enable = false`, Home Manager emits no repository-owned key-file
setting or secret declarations, and consumers receive no secret paths. Their
secret-backed operations remain unavailable.

Activate the disabled configuration without system provisioning:

```sh
nh home switch
```

Install the private Age key outside the repository, then restrict its mode:

```sh
SECURE_KEY_SOURCE="<path-to-secure-key-source>"
install -d -m 700 "$HOME/.config/sops/age"
install -m 600 "$SECURE_KEY_SOURCE" "$HOME/.config/sops/age/keys.txt"
```

Confirm separately that its public recipient is authorized by the
`^secrets/shared\.yaml$` rule in `.sops.yaml`. Then set `enable = true` (or
remove the false override), run `nh home switch` again, and perform the
platform-specific checks in [Verify activation](#verify-activation). If
activation fails, restore `enable = false`, activate again, and correct the key
or recipient authorization before retrying.

Do not use `darwin-rebuild`, a NixOS system switch, `/run/secrets`, or root-owned
provisioning for this user-secret workflow.

## Prerequisites

- `age`, `age-keygen`, and `sops` are installed.
- You have the old private key and every private key needed to decrypt the
  current shared blob.
- You know which recipient in the `secrets/shared.yaml` creation rule is being
  replaced. Preserve recipients for all other active machines.
- You can review changes to `.sops.yaml` and `secrets/shared.yaml` before
  activation.
- You have a secure backup of the retiring private key and will retain it until
  verification succeeds.

## Rotate a recipient

1. Generate a replacement beside the active key. Keep the private key out of
   command output; printing the derived public recipient is safe.

   ```sh
   install -d -m 700 "$HOME/.config/sops/age"
   age-keygen -o "$HOME/.config/sops/age/keys.txt.new"
   chmod 600 "$HOME/.config/sops/age/keys.txt.new"
   NEW_RECIPIENT="$(age-keygen -y "$HOME/.config/sops/age/keys.txt.new")"
   printf '%s\n' "$NEW_RECIPIENT"
   ```

2. In `.sops.yaml`, replace only the retiring recipient in the
   `^secrets/shared\.yaml$` rule. Do not remove other active recipients.

3. Rewrap the shared blob while keys capable of decrypting its current version
   remain available. `CURRENT_KEYS` may be one Age key file or a securely
   assembled file containing all required current identities.

   ```sh
   CURRENT_KEYS="<path-to-current-decryption-keys>"
   COMBINED_KEYS="$(mktemp)"
   trap 'rm -f "$COMBINED_KEYS"' EXIT
   chmod 600 "$COMBINED_KEYS"
   cp "$CURRENT_KEYS" "$COMBINED_KEYS"
   cat "$HOME/.config/sops/age/keys.txt.new" >>"$COMBINED_KEYS"
   SOPS_AGE_KEY_FILE="$COMBINED_KEYS" sops updatekeys -y secrets/shared.yaml
   ```

   The `cat` command above appends a private key to a mode-`0600` temporary file;
   it does not print the key. Do not replace it with a pipeline or diagnostic
   command that writes the key to the terminal.

4. Validate the new recipient without displaying decrypted content:

   ```sh
   SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt.new" \
     sops decrypt secrets/shared.yaml >/dev/null
   sops filestatus secrets/shared.yaml
   nix flake check
   ```

   Review only the encrypted diff. Confirm that secret values are absent, the
   retiring recipient is absent from `.sops.yaml` and the SOPS metadata, and all
   other intended recipients remain.

5. Atomically replace the active user key and activate Home Manager:

   ```sh
   mv "$HOME/.config/sops/age/keys.txt.new" \
     "$HOME/.config/sops/age/keys.txt"
   chmod 600 "$HOME/.config/sops/age/keys.txt"
   nh home switch
   ```

   Do not delete the old key backup until all checks below succeed.

## Verify activation

Choose a secret declared for this host. The following checks test only the
stable Home Manager directory symlink and secret readability; they never read
or print its contents:

```sh
SECRETS_DIR="$HOME/.config/sops-nix/secrets"
SECRET_PATH="$SECRETS_DIR/brave-api-key"
test -L "$SECRETS_DIR"
test -r "$SECRET_PATH"
```

Verify the login service that maintains the user runtime data.

On Darwin, the user launchd domain enables Home Manager activation over SSH
and in headless Background sessions without requiring an Aqua login:

```sh
launchctl print "user/$(id -u)/org.nix-community.home.sops-nix" >/dev/null
```

On Linux:

```sh
systemctl --user is-active --quiet sops-nix.service
```

A failed service check or unreadable symlink means rotation is not complete.
Inspect service diagnostics without dumping environment variables, decrypted
files, or private keys. Re-run `nh home switch` after correcting the problem.
A Darwin system rebuild is neither required nor a valid substitute for this
Home Manager activation check.

## Rollback

Before deleting the old key backup, restore the previous recipient list in
`.sops.yaml` and run `sops updatekeys -y secrets/shared.yaml` using identities
that can decrypt the current blob. Restore the old private key to
`~/.config/sops/age/keys.txt`, enforce mode `0600`, and run:

```sh
nh home switch
```

Repeat the symlink and platform service checks without reading secret contents.
If the retiring key is no longer locally available, recover it from the secure
backup before rewrapping.

## Host-specific policy entries

`.sops.yaml` also contains a creation rule for `secrets/seiran.yaml`, but that
encrypted file does not currently exist and is not declared by
`modules/toplevel/secrets.nix`. Treat the rule as reserved policy, not an active
secret blob. If host-specific secrets are added later, assign every intended
recipient before creating the encrypted file, give the file and declaration a
clear owner, and update this runbook only when the active rotation model
changes.
