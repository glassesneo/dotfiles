{
  delib,
  sopsSecretPaths,
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

    home.ifEnabled = {myconfig, ...}: {
      home.file."${myconfig.programs.pi-coding-agent.configDir}/web-retrieval.json".text = builtins.toJSON {
        schemaVersion = 2;
        providers = [
          {
            id = "parallel-search";
            kind = "parallel-search";
            endpoint = "https://api.parallel.ai/v1beta/search";
            apiKeyFile = sopsSecretPaths."parallel-api-key" or null;
          }
          {
            id = "brave-llm-context";
            kind = "brave-llm-context";
            endpoint = "https://api.search.brave.com/res/v1/llm/context";
            apiKeyFile = sopsSecretPaths."brave-api-key" or null;
          }
          {
            id = "brave-web-search";
            kind = "brave-web-search";
            endpoint = "https://api.search.brave.com/res/v1/web/search";
            apiKeyFile = sopsSecretPaths."brave-free-api-key" or null;
          }
          {
            id = "exa-search";
            kind = "exa-search";
            endpoint = "https://api.exa.ai/search";
            apiKeyFile = sopsSecretPaths."exa-api-key" or null;
          }
          {
            id = "parallel-extract";
            kind = "parallel-extract";
            endpoint = "https://api.parallel.ai/v1beta/extract";
            apiKeyFile = sopsSecretPaths."parallel-api-key" or null;
          }
          {
            id = "exa-contents";
            kind = "exa-contents";
            endpoint = "https://api.exa.ai/contents";
            apiKeyFile = sopsSecretPaths."exa-api-key" or null;
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
