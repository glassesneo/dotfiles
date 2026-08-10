{
  delib,
  homeConfig,
  ...
}: let
  moduleName = "programs.pi-coding-agent.web_retrieval";
  extensionSource = ./../../extensions_src;
  webSearchExtension = "${extensionSource}/web_search.ts";
  webFetchExtension = "${extensionSource}/web_fetch.ts";
in
  delib.module {
    name = moduleName;

    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = readOnly (boolOption (parent.enable && builtins.elem "web_retrieval" parent.defaultExtensions));
        extensionPaths = readOnly (listOfOption str [
          webSearchExtension
          webFetchExtension
        ]);
      });

    home.ifEnabled = {myconfig, ...}: let
      secretPath = name:
        if builtins.hasAttr name homeConfig.sops.secrets
        then homeConfig.sops.secrets.${name}.path
        else null;
    in {
      home.file."${myconfig.programs.pi-coding-agent.configDir}/web-retrieval.json".text = builtins.toJSON {
        schemaVersion = 2;
        providers = [
          {
            id = "parallel-search";
            kind = "parallel-search";
            endpoint = "https://api.parallel.ai/v1/search";
            apiKeyFile = secretPath "parallel-api-key";
          }
          {
            id = "brave-llm-context";
            kind = "brave-llm-context";
            endpoint = "https://api.search.brave.com/res/v1/llm/context";
            apiKeyFile = secretPath "brave-api-key";
          }
          {
            id = "brave-web-search";
            kind = "brave-web-search";
            endpoint = "https://api.search.brave.com/res/v1/web/search";
            apiKeyFile = secretPath "brave-free-api-key";
          }
          {
            id = "exa-search";
            kind = "exa-search";
            endpoint = "https://api.exa.ai/search";
            apiKeyFile = secretPath "exa-api-key";
          }
          {
            id = "parallel-extract";
            kind = "parallel-extract";
            endpoint = "https://api.parallel.ai/v1beta/extract";
            apiKeyFile = secretPath "parallel-api-key";
          }
          {
            id = "exa-contents";
            kind = "exa-contents";
            endpoint = "https://api.exa.ai/contents";
            apiKeyFile = secretPath "exa-api-key";
          }
        ];
        routing = {
          generalFamilies = {
            parallel = 5;
            brave = 1;
          };
          braveProviders = {
            brave-llm-context = 2;
            brave-web-search = 1;
          };
        };
        deadlinesMs = {
          search = 30000;
          fetch = 60000;
        };
        retry = {
          maxRetries = 1;
          defaultWaitMs = 1000;
        };
      };
    };
  }
