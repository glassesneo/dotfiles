let
  # Import host public key registry
  hosts = import ./hosts.nix;

  # Extract all host keys for encryption
  allHostKeys = builtins.attrValues hosts;

  # List of all secret names (must match agenix-secrets.nix)
  # NOTE: This list is duplicated from modules/config/agenix-secrets.nix
  # because we can't import that module here (Denix auto-loading limitation)
  secretNames = [
    "claude-code-oauth-token"
    "gemini-api-key"
    "ai-mop-api-key"
    "brave-api-key"
    "openrouter-api-key"
    "tavily-api-key"
    "hf-inference-api-key"
    "cerebras-api-key"
    "morph-fast-apply-api-key"
    "io-intelligence-api-key"
    "google-cloud-api-key"
    "iniad-id"
    "iniad-password"
  ];

  # Generate secret entry for a single secret
  mkSecret = secretName: {
    "${secretName}.age".publicKeys = allHostKeys;
  };
in
  # Auto-generate secret entries for all hosts
  builtins.foldl' (a: b: a // b) {} (map mkSecret secretNames)
