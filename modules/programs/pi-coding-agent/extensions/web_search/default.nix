{
  delib,
  sopsSecretPaths,
  ...
}: let
  moduleName = "programs.pi-coding-agent.web_search";
  webSearchExtension = "${./../../extensions_src}/web_search.ts";
in
  delib.module {
    name = moduleName;

    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = readOnly (boolOption (parent.enable && builtins.elem "web_search" parent.defaultExtensions));
        extensionPaths = readOnly (listOfOption str [webSearchExtension]);
      });

    myconfig.ifEnabled = {
      programs.pi-coding-agent.subagent.childExtensionContributions.web_search = [webSearchExtension];
      programs.pi-coding-agent.profile.profiles.librarian.tools = ["web_search"];
    };

    home.ifEnabled = {
      myconfig,
      ...
    }: {
      home.file."${myconfig.programs.pi-coding-agent.configDir}/web-search.json".text = builtins.toJSON {
        schemaVersion = 1;
        providers = [
          {
            id = "brave";
            kind = "brave-llm-context";
            endpoint = "https://api.search.brave.com/res/v1/llm/context";
            apiKeyFile = sopsSecretPaths."brave-api-key" or null;
          }
        ];
      };
    };
  }
