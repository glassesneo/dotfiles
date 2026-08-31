{
  delib,
  homeConfig,
  lib,
  llm-agents,
  piArtifact,
  piOrchestration,
  piQuestion,
  pkgs,
  ...
}: let
  configDir = "${homeConfig.home.homeDirectory}/.pi/agent";
  artifactRuntimeDir = "${configDir}/extensions-runtime";
  artifactExtensionPath = "${artifactRuntimeDir}/extensions_src/agent_artifact.ts";
  emergencyConfigDir = "${homeConfig.home.homeDirectory}/.pi/emergency-agent";
  modelDefaults = {
    defaultProvider = "openai-codex";
    defaultModel = "gpt-5.6-sol";
    defaultThinkingLevel = "medium";
  };
  # Repository-owned soft ceiling for Pi's native compaction scheduler; this does
  # not represent Sol's provider-side context capability.
  modelOverrides = {
    providers."openai-codex".modelOverrides."gpt-5.6-sol".contextWindow = 272000;
  };
  codexCompactionConfig = {
    autoCompact = true;
    thresholdRatio = 0.9;
  };
  nativeLifecycleSettings = {
    compaction = {
      enabled = true;
      reserveTokens = 16384;
      keepRecentTokens = 20000;
    };
    retry = {
      enabled = true;
      maxRetries = 3;
      baseDelayMs = 2000;
      provider = {
        maxRetries = 0;
        maxRetryDelayMs = 60000;
      };
    };
  };
  profileType = delib.submodule {
    options = with delib; {
      model = noDefault (strOption null);
      thinkingLevel = allowNull (enumOption ["off" "minimal" "low" "medium" "high" "xhigh" "max"] null);
      harness = enumOption ["pi" "cursor-agent" "codex"] "pi";
      harnessOptions = attrsOfOption lib.types.anything {};
    };
  };
  packageContributionType = delib.submodule {
    options = with delib; {
      enabled = boolOption true;
      source = noDefault (strOption null);
      extensions = allowNull (listOfOption str null);
    };
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
        profiles = attrsOfOption profileType {};
        packageContributions = attrsOfOption packageContributionType {};
        defaultExtensions = readOnly (listOfOption str [
          "popup"
          "mode"
          "orchestration"
          "command_palette"
          "web_retrieval"
          "performance"
        ]);
      };

    myconfig.always = {...}: {
      args.shared.piArtifactRuntime.extensionPath = artifactExtensionPath;
      programs.pi-coding-agent = {
        packageContributions = {
          codex-compaction.source = "npm:@ogulcancelik/pi-codex-compaction@0.1.3";
          decision-ui = {
            enabled = piQuestion.enabled || piArtifact.enabled || piOrchestration.enabled;
            source = "npm:@glassesneo/pi-decision-ui@0.1.1";
            extensions =
              if piQuestion.enabled
              then null
              else [];
          };
        };
        profiles = lib.mapAttrs (_: profile: lib.mapAttrs (_: lib.mkDefault) profile) {
          sol-high = {
            model = "openai-codex/gpt-5.6-sol";
            thinkingLevel = "high";
          };
          sol-medium = {
            model = "openai-codex/gpt-5.6-sol";
            thinkingLevel = "medium";
          };
          luna-high = {
            model = "openai-codex/gpt-5.6-luna";
            thinkingLevel = "high";
          };
          luna-xhigh = {
            model = "openai-codex/gpt-5.6-luna";
            thinkingLevel = "xhigh";
          };
          terra-high = {
            model = "openai-codex/gpt-5.6-terra";
            thinkingLevel = "high";
          };
          cursor-read = {
            model = "cursor/cursor-grok-4.5-high-fast";
            thinkingLevel = null;
            harness = "cursor-agent";
            harnessOptions = {
              mode = "ask";
              permissionPolicy = "reject";
              sandbox = "disabled";
              trustWorkspace = true;
              worktree = false;
            };
          };
          cursor-write = {
            model = "cursor/cursor-grok-4.5-high-fast";
            thinkingLevel = null;
            harness = "cursor-agent";
            harnessOptions = {
              mode = "agent";
              permissionPolicy = "allow-always";
              sandbox = "disabled";
              trustWorkspace = true;
              worktree = false;
            };
          };
          codex-search = {
            model = "codex/gpt-5.6-luna";
            thinkingLevel = "high";
            harness = "codex";
            harnessOptions = {
              mode = "read-only";
              permissionPolicy = "reject";
              webSearch = "cached";
            };
          };
        };
      };
    };

    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      packageContributionNames = builtins.attrNames cfg.packageContributions;
      enabledPackageContributionNames = builtins.filter (name: cfg.packageContributions.${name}.enabled) packageContributionNames;
      packageSources = map (name: let
        contribution = cfg.packageContributions.${name};
      in
        if contribution.extensions == null
        then contribution.source
        else {
          inherit (contribution) source extensions;
        })
      enabledPackageContributionNames;
      packageContributionSources = map (name: cfg.packageContributions.${name}.source) packageContributionNames;
      duplicateValues = values:
        builtins.filter
        (value: lib.count (candidate: candidate == value) values > 1)
        (lib.unique values);
      semverNumericIdentifier = "(0|[1-9][0-9]*)";
      semverPrereleaseIdentifier = "(${semverNumericIdentifier}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
      semverPrerelease = "${semverPrereleaseIdentifier}(\\.${semverPrereleaseIdentifier})*";
      semverBuild = "[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*";
      concreteNpmSourcePattern = "^npm:.+@${semverNumericIdentifier}\\.${semverNumericIdentifier}\\.${semverNumericIdentifier}(-${semverPrerelease})?(\\+${semverBuild})?$";
      invalidNpmPackageContributionNames = builtins.filter (name: let
        source = cfg.packageContributions.${name}.source;
      in
        lib.hasPrefix "npm:" source
        && builtins.match concreteNpmSourcePattern source == null)
      packageContributionNames;
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
      artifactRuntimeRequired = piArtifact.enabled || piOrchestration.enabled;
      emergencySettings =
        modelDefaults
        // nativeLifecycleSettings
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
          "execution-profiles.json"
          "agent-modes.json"
          "role-catalog.json"
          "orchestration.json"
          "web-retrieval.json"
          "extension-keybindings.json"
        ]);
    in {
      assertions = [
        {
          assertion = duplicateValues packageContributionSources == [];
          message = "Pi package contributions must not duplicate sources: ${lib.concatStringsSep ", " (duplicateValues packageContributionSources)}.";
        }
        {
          assertion = invalidNpmPackageContributionNames == [];
          message = "Pi npm package contributions must use concrete semver versions: ${lib.concatStringsSep ", " invalidNpmPackageContributionNames}.";
        }
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
          // nativeLifecycleSettings
          // {
            packages = packageSources;
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
          "${cfg.configDir}/pi-codex-compaction.json".text = builtins.toJSON codexCompactionConfig;
          "${cfg.configDir}/execution-profiles.json".text = builtins.toJSON {
            schemaVersion = 1;
            profiles = lib.mapAttrs (_: profile: lib.filterAttrs (_name: value: value != null && value != {}) profile) cfg.profiles;
          };
        }
        // lib.optionalAttrs artifactRuntimeRequired {
          "${artifactRuntimeDir}/extensions_src".source = homeConfig.lib.file.mkOutOfStoreSymlink "${./extensions_src}";
          "${artifactRuntimeDir}/node_modules".source = homeConfig.lib.file.mkOutOfStoreSymlink "${cfg.configDir}/npm/node_modules";
        }
        // lib.optionalAttrs cfg.emergency.enable (sharedEmergencyFiles
          // {
            "${emergencyConfigDir}/settings.json".text = builtins.toJSON emergencySettings;
          });
    };
  }
