# Agenix Secrets Management

This directory contains encrypted secrets using [agenix](https://github.com/ryantm/agenix).

## Architecture Overview

The agenix setup uses a centralized, DRY approach:

- **`hosts.nix`**: Registry of all host SSH public keys
- **`secrets.nix`**: Auto-generates secret entries for all hosts from the registry
- **`modules/config/agenix-secrets.nix`**: Canonical list of secret names and environment variable mappings
- **`modules/config/agenix-shared.nix`**: Shared module that auto-configures agenix for any host
- **`hosts/<hostname>/agenix.nix`**: Per-host configuration (2 lines) specifying which secrets to export

### Secret Decryption vs Export

- **All hosts can decrypt all secrets** (simplifies key management)
- **Each host explicitly chooses which secrets to export** as environment variables (granular control, security through explicit declaration)

## Adding a New Host

### 1. Generate SSH key on the new host

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_agenix -C "neo@new-hostname"
cat ~/.ssh/id_agenix.pub
```

### 2. On management machine (this repo)

```bash
cd ~/.dotfiles

# Add host public key to registry
# Edit secrets/hosts.nix and add:
#   new-hostname = "ssh-ed25519 AAAA... neo@new-hostname";
```

### 3. Re-encrypt all secrets with new host key

```bash
cd secrets
for age_file in *.age; do
  agenix -r -i ~/.ssh/id_agenix "$age_file"
done
```

### 4. Create host configuration

```bash
cd ~/.dotfiles
mkdir -p hosts/new-hostname

cat > hosts/new-hostname/agenix.nix <<'EOF'
{delib, ...}:
delib.host {
  name = "new-hostname";

  myconfig.agenix-shared = {
    enable = true;
    # Choose which secrets to export as environment variables on this host
    exportSecrets = [
      "brave-api-key"
      "tavily-api-key"
      "claude-code-oauth-token"
    ];
  };
}
EOF
```

### 5. Commit and push

```bash
git add secrets/hosts.nix secrets/*.age hosts/new-hostname/
git commit -m "Add host: new-hostname"
git push
```

### 6. On new machine, pull and activate

```bash
cd ~/.dotfiles
git pull
nh darwin switch . -H new-hostname -Lt  # or: nh home switch

# Verify only selected secrets are exported
echo $BRAVE_API_KEY        # Should show value
echo $GEMINI_API_KEY       # Should be empty (not in exportSecrets)
```

## Adding a New Secret

### 1. Update the canonical secret list

Edit `modules/config/agenix-secrets.nix` and add:
- Secret name to `secretNames` list
- Environment variable mapping to `secretToEnvVar` attrset

### 2. Update secrets.nix

Edit `secrets/secrets.nix` and add the secret name to the `secretNames` list.

**Note**: This list is duplicated from `agenix-secrets.nix` due to Denix auto-loading limitations.

### 3. Create the encrypted secret file

```bash
cd secrets
agenix -e <secret-name>.age
# Enter the secret value in your editor, save and exit
```

### 4. Update host configurations

For each host that should export this secret, edit `hosts/<hostname>/agenix.nix` and add the secret name to the `exportSecrets` list.

### 5. Commit and deploy

```bash
git add modules/config/agenix-secrets.nix secrets/secrets.nix secrets/<secret-name>.age
git commit -m "Add secret: <secret-name>"
git push

# On each host:
nh darwin switch . -H <hostname> -Lt  # or: nh home switch
```

## Re-encrypting Secrets

When rotating keys or updating secrets:

```bash
cd secrets

# Re-encrypt a single secret
agenix -r -i ~/.ssh/id_agenix <secret-name>.age

# Re-encrypt all secrets
for age_file in *.age; do
  agenix -r -i ~/.ssh/id_agenix "$age_file"
done
```

## Troubleshooting

### Secret not decrypting

1. Verify host SSH key is in `secrets/hosts.nix`
2. Verify secret was re-encrypted with host's public key:
   ```bash
   cd secrets
   agenix -r -i ~/.ssh/id_agenix <secret-name>.age
   ```
3. Check agenix launchd service is running:
   ```bash
   launchctl list | grep agenix
   ```

### Environment variable not set

1. Verify secret name is in host's `exportSecrets` list
2. Rebuild and activate: `nh darwin switch . -H <hostname> -Lt`
3. Start a new shell session (environment variables are set on shell initialization)
4. Check the mapping in `modules/config/agenix-secrets.nix`

### Permission errors

Agenix secrets are stored in the user's runtime directory with restricted permissions. If you get permission errors:

1. Check file ownership and permissions
2. Verify the agenix activation ran successfully during last system switch
3. Re-run activation: `nh darwin switch . -H <hostname> -Lt`

## Files

- `secrets/hosts.nix` - Host public key registry
- `secrets/secrets.nix` - Auto-generates secret entries for all hosts
- `secrets/*.age` - Encrypted secret files
- `modules/config/agenix-secrets.nix` - Canonical secret definitions
- `modules/config/agenix-shared.nix` - Shared agenix module
- `hosts/<hostname>/agenix.nix` - Per-host secret export configuration
