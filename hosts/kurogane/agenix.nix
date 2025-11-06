{
  delib,
  homeConfig,
  inputs,
  lib,
  pkgs,
  ...
}:
delib.host {
  name = "kurogane";

  home = {myconfig, ...}: {
    imports = [inputs.agenix.homeManagerModules.default];
    age = {
      identityPaths = ["/Users/${myconfig.constants.username}/.ssh/id_agenix"];
      secrets = {
        claude-code-oauth-token.file = ../../secrets/claude-code-oauth-token.age;
        gemini-api-key.file = ../../secrets/gemini-api-key.age;
        ai-mop-api-key.file = ../../secrets/ai-mop-api-key.age;
        brave-api-key.file = ../../secrets/brave-api-key.age;
        tavily-api-key.file = ../../secrets/tavily-api-key.age;
        hf-inference-api-key.file = ../../secrets/hf-inference-api-key.age;
        cerebras-api-key.file = ../../secrets/cerebras-api-key.age;
        morph-fast-apply-api-key.file = ../../secrets/morph-fast-apply-api-key.age;
        io-intelligence-api-key.file = ../../secrets/io-intelligence-api-key.age;
        iniad-id.file = ../../secrets/iniad-id.age;
        iniad-password.file = ../../secrets/iniad-password.age;
      };
    };
    home.sessionVariables = let
      cat = lib.getExe' pkgs.coreutils "cat";
    in {
      BRAVE_API_KEY = ''$(${cat} ${homeConfig.age.secrets.brave-api-key.path})'';
      TAVILY_API_KEY = ''$(${cat} ${homeConfig.age.secrets.tavily-api-key.path})'';
      CLAUDE_CODE_OAUTH_TOKEN = ''$(${cat} ${homeConfig.age.secrets.claude-code-oauth-token.path})'';
      GEMINI_API_KEY = ''$(${cat} ${homeConfig.age.secrets.gemini-api-key.path})'';
      AI_MOP_API_KEY = ''$(${cat} ${homeConfig.age.secrets.ai-mop-api-key.path})'';
      HF_INFERENCE_API_KEY = ''$(${cat} ${homeConfig.age.secrets.hf-inference-api-key.path})'';
      CEREBRAS_API_KEY = ''$(${cat} ${homeConfig.age.secrets.cerebras-api-key.path})'';
      MORPH_FAST_APPLY_API_KEY = ''$(${cat} ${homeConfig.age.secrets.morph-fast-apply-api-key.path})'';
      IO_INTELLIGENCE_API_KEY = ''$(${cat} ${homeConfig.age.secrets.io-intelligence-api-key.path})'';
      INIAD_ID = ''$(${cat} ${homeConfig.age.secrets.iniad-id.path})'';
      INIAD_PASSWORD = ''$(${cat} ${homeConfig.age.secrets.iniad-password.path})'';
    };
  };
}
