{delib, ...}:
delib.host {
  name = "kurogane";

  myconfig.config.agenix-shared = {
    enable = true;
    # Export all 13 secrets (same as current behavior)
    exportSecrets = [
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
  };
}
