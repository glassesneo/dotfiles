{
  delib,
  sopsSecretPaths,
  ...
}:
delib.module {
  name = "programs.opencode";

  home.ifEnabled = let
    secretPath = name: sopsSecretPaths.${name} or "/run/secrets/${name}";
  in {
    programs.opencode.settings = {
      experimental = {
        mcp_timeout = 1200000;
      };
      plugin = [];
      provider = {
        openrouter = {
          options = {
            apiKey = "{file:${secretPath "openrouter-api-key"}}";
          };
        };
        ollama = {
          npm = "@ai-sdk/openai-compatible";
          name = "Ollama";
          options = {
            baseURL = "http://127.0.0.1:11434/v1";
          };
          models = {
            "gemma4:e4b" = {
              name = "Gemma 4 E4B";
              limit = {
                context = 32768;
                output = 8192;
              };
            };

            # "qwen3.5:9b" = {
            #   name = "Qwen 3.5 9B";
            #   limit = {
            #     context = 32768;
            #     output = 8192;
            #   };
            # };
          };
        };
      };
    };
  };
}
