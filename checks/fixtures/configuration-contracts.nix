{
  configurationSource,
  mode ? "normal",
}: let
  f = builtins.getFlake configurationSource;
  lib = f.inputs.nixpkgs.lib;
  base = f.homeConfigurations."neo@seiran";
  invalidKeybindings = base.extendModules {
    modules = [
      {
        myconfig.programs.pi-coding-agent.keybindings.overrides = {
          commandPalette = {
            open = ["not-a-key"];
            moveUp = ["esc"];
            cancel = ["escape"];
            typo = ["x"];
          };
          question = {
            submit = [];
            "common.cancel" = ["e"];
          };
          pi = {
            "tui.editor.cursorUp" = ["ctrl+c"];
            "app.exit" = [];
          };
          tmuxPreview.openFull = ["clear"];
        };
      }
    ];
  };

  reject = module:
    builtins.tryEval ((base.extendModules {modules = [module];}).activationPackage.drvPath);

  aliasOverride = base.extendModules {
    modules = [{myconfig.programs.pi-coding-agent.keybindings.overrides.pi."app.exit" = ["f12"];}];
  };
  navigation = base.extendModules {
    modules = [
      {
        myconfig.programs.tmux.prefix = "F11";
        myconfig.programs.pi-coding-agent.keybindings.overrides.meshNavigation.parent = ["f10"];
      }
    ];
  };
  disabled = base.extendModules {
    modules = [{myconfig.programs.pi-coding-agent.emergency.enable = false;}];
  };
  questionDisabled = base.extendModules {
    modules = [{myconfig.programs.pi-coding-agent.question.enable = false;}];
  };
  darwin = f.darwinConfigurations.seiran;
  partialHomeSecrets = base.extendModules {
    modules = [{myconfig.toplevel.secrets.names = lib.mkForce ["parallel-api-key" "exa-api-key"];}];
  };
  partialDarwinSecrets = darwin.extendModules {
    modules = [{myconfig.toplevel.secrets.names = lib.mkForce ["parallel-api-key" "exa-api-key"];}];
  };
  disabledDarwinSecrets = darwin.extendModules {
    modules = [{myconfig.toplevel.secrets.enable = lib.mkForce false;}];
  };
  retrievalSecretNames = ["parallel-api-key" "brave-api-key" "brave-free-api-key" "exa-api-key"];

  collectDarwinWebRetrieval = system: let
    c = system.config.home-manager.users.neo;
    configDir = "${c.home.homeDirectory}/.pi/agent";
  in {
    config = builtins.fromJSON (builtins.unsafeDiscardStringContext c.home.file."${configDir}/web-retrieval.json".text);
    secretPaths = builtins.listToAttrs (map (name: {
        inherit name;
        value = system.config.sops.secrets.${name}.path or null;
      })
      retrievalSecretNames);
  };

  collectHomeWebRetrieval = home: let
    c = home.config;
    configDir = "${c.home.homeDirectory}/.pi/agent";
  in {
    config = builtins.fromJSON (builtins.unsafeDiscardStringContext c.home.file."${configDir}/web-retrieval.json".text);
    secretPaths = builtins.listToAttrs (map (name: {
        inherit name;
        value =
          if c.myconfig.toplevel.secrets.enable && builtins.elem name c.myconfig.toplevel.secrets.names
          then "/run/secrets/${name}"
          else null;
      })
      retrievalSecretNames);
  };

  collectEmergency = home: let
    c = home.config;
    cfg = c.myconfig.programs.pi-coding-agent;
    emergencyDir = "${c.home.homeDirectory}/.pi/emergency-agent";
    extensionPaths = builtins.concatLists (map
      (name: c.myconfig.programs.pi-coding-agent.${name}.extensionPaths)
      cfg.defaultExtensions);
  in {
    inherit emergencyDir extensionPaths;
    optionEnabled = cfg.emergency.enable;
    normalSettings = c.programs.pi-coding-agent.settings;
    emergencySettings =
      if builtins.hasAttr "${emergencyDir}/settings.json" c.home.file
      then builtins.fromJSON (builtins.unsafeDiscardStringContext c.home.file."${emergencyDir}/settings.json".text)
      else null;
    emergencyFiles = builtins.filter (name: builtins.match "${emergencyDir}/.*" name != null) (builtins.attrNames c.home.file);
    packages = builtins.listToAttrs (map (package: {
        name = package.pname or package.name;
        value = {
          path = toString package;
          drvPath = builtins.unsafeDiscardStringContext package.drvPath;
        };
      }) (builtins.filter
        (package: builtins.elem (package.pname or package.name) ["pi-emergency" "pi-emergency-full"])
        c.home.packages));
    links = builtins.listToAttrs (map (name: {
      inherit name;
      value = let
        source = c.home.file."${emergencyDir}/${name}".source;
      in {
        drvPath = builtins.unsafeDiscardStringContext source.drvPath;
        source = toString source;
        target = "${cfg.configDir}/${name}";
      };
    }) ["auth.json" "models.json" "agent-modes.json" "agent-catalog.json" "orchestration.json" "web-retrieval.json" "extension-keybindings.json"]);
  };

  disabledConfig = disabled.config;
  disabledDir = "${disabledConfig.home.homeDirectory}/.pi/emergency-agent";
in
  if mode == "diagnostic"
  then invalidKeybindings.activationPackage.drvPath
  else if mode != "normal"
  then throw "unknown configuration contract fixture mode: ${mode}"
  else {
    schemaVersion = 1;
    rejections = {
      criticMutation = reject {
        myconfig.programs.pi-coding-agent.orchestration.agents.critic.tools = lib.mkForce ["read" "write"];
      };
      childExtensionMutation = reject {
        myconfig.programs.pi-coding-agent.orchestration.agents.reviewer.childExtensionContributions = lib.mkForce ["/unexpected.ts"];
      };
      roleSetMutation = reject {
        myconfig.programs.pi-coding-agent.orchestration.roleSets."mode:recon" = lib.mkForce ["explorer" "reviewer" "codex"];
      };
      budgetMutation = reject {
        myconfig.programs.pi-coding-agent.orchestration.budgets.maxLiveAgents = lib.mkForce 13;
      };
    };
    generated = {
      pi = {
        defaultExtensionNames = base.config.myconfig.programs.pi-coding-agent.defaultExtensions;
        defaultExtensionPaths = base.config.programs.pi-coding-agent.settings.extensions;
        modes = builtins.fromJSON (builtins.unsafeDiscardStringContext base.config.home.file."${base.config.home.homeDirectory}/.pi/agent/agent-modes.json".text);
        questionDisabled = {
          extensionPaths = questionDisabled.config.programs.pi-coding-agent.settings.extensions;
          modes = builtins.fromJSON (builtins.unsafeDiscardStringContext questionDisabled.config.home.file."${questionDisabled.config.home.homeDirectory}/.pi/agent/agent-modes.json".text);
        };
        catalog = builtins.fromJSON (builtins.unsafeDiscardStringContext base.config.home.file."${base.config.home.homeDirectory}/.pi/agent/agent-catalog.json".text);
        models = builtins.fromJSON (builtins.unsafeDiscardStringContext base.config.home.file."${base.config.home.homeDirectory}/.pi/agent/models.json".text);
        orchestration = builtins.fromJSON (builtins.unsafeDiscardStringContext base.config.home.file."${base.config.home.homeDirectory}/.pi/agent/orchestration.json".text);
        extensionKeybindings = builtins.fromJSON (builtins.unsafeDiscardStringContext aliasOverride.config.home.file."${aliasOverride.config.home.homeDirectory}/.pi/agent/extension-keybindings.json".text);
        navigationRuntime = builtins.fromJSON (builtins.unsafeDiscardStringContext navigation.config.home.file."${navigation.config.home.homeDirectory}/.pi/agent/orchestration.json".text);
        navigationTmux = navigation.config.programs.tmux.extraConfig;
        darwinTmux = darwin.config.home-manager.users.neo.programs.tmux.extraConfig;
      };
      webRetrieval = {
        home = collectHomeWebRetrieval base;
        homePartial = collectHomeWebRetrieval partialHomeSecrets;
        darwin = collectDarwinWebRetrieval darwin;
        darwinPartial = collectDarwinWebRetrieval partialDarwinSecrets;
        darwinDisabled = collectDarwinWebRetrieval disabledDarwinSecrets;
      };
      emergency = {
        enabled = collectEmergency base;
        disabled = {
          optionEnabled = disabledConfig.myconfig.programs.pi-coding-agent.emergency.enable;
          packages =
            builtins.filter
            (name: builtins.elem name ["pi-emergency" "pi-emergency-full"])
            (map (package: package.pname or package.name) disabledConfig.home.packages);
          emergencyFiles = builtins.filter (name: builtins.match "${disabledDir}/.*" name != null) (builtins.attrNames disabledConfig.home.file);
        };
      };
    };
  }
