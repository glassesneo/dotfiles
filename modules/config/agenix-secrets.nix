# Canonical list of all agenix secrets
# This is the single source of truth for secret names and their environment variable mappings
{delib, ...}: let
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

  secretToEnvVar = {
    claude-code-oauth-token = "CLAUDE_CODE_OAUTH_TOKEN";
    gemini-api-key = "GEMINI_API_KEY";
    ai-mop-api-key = "AI_MOP_API_KEY";
    brave-api-key = "BRAVE_API_KEY";
    openrouter-api-key = "OPENROUTER_API_KEY";
    tavily-api-key = "TAVILY_API_KEY";
    hf-inference-api-key = "HF_INFERENCE_API_KEY";
    cerebras-api-key = "CEREBRAS_API_KEY";
    morph-fast-apply-api-key = "MORPH_API_KEY";
    io-intelligence-api-key = "IO_INTELLIGENCE_API_KEY";
    google-cloud-api-key = "GOOGLE_CLOUD_API_KEY";
    iniad-id = "INIAD_ID";
    iniad-password = "INIAD_PASSWORD";
  };
in
  delib.module {
    name = "config.agenix-secrets";

    myconfig.always.args.shared.agenixSecrets = {
      inherit secretNames secretToEnvVar;
    };
  }
