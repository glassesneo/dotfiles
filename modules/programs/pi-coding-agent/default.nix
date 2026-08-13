{
  delib,
  homeConfig,
  lib,
  llm-agents,
  pkgs,
  ...
}: let
  configDir = "${homeConfig.home.homeDirectory}/.pi/agent";
  emergencyConfigDir = "${homeConfig.home.homeDirectory}/.pi/emergency-agent";
  modelDefaults = {
    defaultProvider = "openai-codex";
    defaultModel = "gpt-5.6-sol";
    defaultThinkingLevel = "medium";
  };
  # Sol alone opts into Pi's long-context tier; requests beyond 272K may price the
  # whole request at that tier. Luna and Terra deliberately retain provider metadata.
  modelOverrides = {
    providers."openai-codex".modelOverrides."gpt-5.6-sol".contextWindow = 1050000;
  };
in
  delib.module {
    name = "programs.pi-coding-agent";

    options = with delib;
      moduleOptions {
        enable = boolOption true;
        configDir = readOnly (strOption configDir);
        emergency = submoduleOption {
          options.enable = boolOption true;
        } {};
        defaultExtensions = readOnly (listOfOption str [
          "popup"
          "mode"
          "orchestration"
          "command_palette"
          "web_retrieval"
        ]);
      };

    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      resolveModule = name: let
        path = ["programs" "pi-coding-agent"] ++ lib.splitString "." name;
      in
        if lib.hasAttrByPath path myconfig
        then lib.attrByPath path null myconfig
        else null;
      selected =
        map (name: {
          inherit name;
          module = resolveModule name;
        })
        cfg.defaultExtensions;
      extensionPaths = lib.concatMap (item:
        if item.module != null && item.module ? extensionPaths
        then item.module.extensionPaths
        else [])
      selected;
      missingNames = map (item: item.name) (builtins.filter (item: item.module == null) selected);
      disabledNames = map (item: item.name) (builtins.filter (item: item.module != null && !(item.module ? enable && item.module.enable)) selected);
      emptyPathNames = map (item: item.name) (builtins.filter (item: item.module != null && !(item.module ? extensionPaths && item.module.extensionPaths != [])) selected);
      names = values: lib.concatStringsSep ", " values;
      emergencySettings =
        modelDefaults
        // {
          extensions = extensionPaths;
          prompts = [
            "${./prompts}"
          ];
          theme = "dark";
        };
      mkEmergencyLauncher = name: flags:
        pkgs.writeShellApplication {
          inherit name;
          text = ''
            export PI_CODING_AGENT_DIR=${lib.escapeShellArg emergencyConfigDir}
            export PI_CODING_AGENT_SESSION_DIR=${lib.escapeShellArg "${cfg.configDir}/sessions"}
            exec ${lib.getExe llm-agents.pi} ${lib.escapeShellArgs flags} "$@"
          '';
        };
      emergencyLauncher = mkEmergencyLauncher "pi-emergency" [
        "--no-extensions"
        "--no-skills"
        "--no-prompt-templates"
        "--no-themes"
        "--no-approve"
      ];
      emergencyFullLauncher = mkEmergencyLauncher "pi-emergency-full" ["--no-approve"];
      sharedEmergencyFiles = builtins.listToAttrs (map (name: {
          name = "${emergencyConfigDir}/${name}";
          value.source = homeConfig.lib.file.mkOutOfStoreSymlink "${cfg.configDir}/${name}";
        }) [
          "auth.json"
          "models.json"
          "agent-modes.json"
          "agent-catalog.json"
          "orchestration.json"
          "web-retrieval.json"
          "extension-keybindings.json"
        ]);
    in {
      assertions = [
        {
          assertion = builtins.all (item: item.module != null) selected;
          message = "Pi defaultExtensions must reference existing modules below programs.pi-coding-agent; missing: ${names missingNames}.";
        }
        {
          assertion = builtins.all (item: item.module == null || (item.module ? enable && item.module.enable)) selected;
          message = "Pi selected default extension modules must be enabled; disabled: ${names disabledNames}.";
        }
        {
          assertion = builtins.all (item: item.module == null || (item.module ? extensionPaths && item.module.extensionPaths != [])) selected;
          message = "Pi selected default extension modules must expose non-empty extensionPaths; invalid: ${names emptyPathNames}.";
        }
      ];

      programs.pi-coding-agent = {
        enable = true;
        package = llm-agents.pi;
        inherit (cfg) configDir;
        settings =
          modelDefaults
          // {
            extensions = lib.mkBefore extensionPaths;
            prompts = [
              "${./prompts}"
            ];
            theme = "dark";
          };
      };

      home.packages = lib.mkIf cfg.emergency.enable [
        emergencyLauncher
        emergencyFullLauncher
      ];
      home.file =
        {
          "${cfg.configDir}/models.json".text = builtins.toJSON modelOverrides;
        }
        // lib.optionalAttrs cfg.emergency.enable (sharedEmergencyFiles
          // {
            "${emergencyConfigDir}/settings.json".text = builtins.toJSON emergencySettings;
          });
    };
  }
