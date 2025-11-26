let
  userKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBOIatJ4jxTsywrBNYLuIP4p8AIANP1jmj7wM0KcIXb/ neo@macos-personal-laptop-01";
in {
  "claude-code-oauth-token.age".publicKeys = [userKey];
  "gemini-api-key.age".publicKeys = [userKey];
  "ai-mop-api-key.age".publicKeys = [userKey];
  "brave-api-key.age".publicKeys = [userKey];
  "openrouter-api-key.age".publicKeys = [userKey];
  "tavily-api-key.age".publicKeys = [userKey];
  "hf-inference-api-key.age".publicKeys = [userKey];
  "cerebras-api-key.age".publicKeys = [userKey];
  "morph-fast-apply-api-key.age".publicKeys = [userKey];
  "io-intelligence-api-key.age".publicKeys = [userKey];
  "google-cloud-api-key.age".publicKeys = [userKey];
  "iniad-id.age".publicKeys = [userKey];
  "iniad-password.age".publicKeys = [userKey];
}
