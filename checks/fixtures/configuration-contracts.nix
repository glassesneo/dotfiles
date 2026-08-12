{
  configurationSource,
  mode ? "normal",
}: let
  f = builtins.getFlake configurationSource;
  lib = f.inputs.nixpkgs.lib;
  base = f.homeConfigurations."neo@seiran";
  clean = f.homeConfigurations."neo@seiran-clean";
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
    builtins.tryEval (base.extendModules {modules = [module];}).activationPackage.drvPath;

  contract = concern: condition:
    if condition
    then true
    else throw "configuration contract failed: ${concern}";

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
  partialSecrets = {
    myconfig.toplevel.secrets.entries = lib.mkForce {
      ai-mop-api-key = {};
      parallel-api-key = {};
      exa-api-key = {};
    };
  };
  disableSecrets = {myconfig.toplevel.secrets.enable = lib.mkForce false;};
  partialHomeSecrets = base.extendModules {modules = [partialSecrets];};
  disabledHomeSecrets = base.extendModules {modules = [disableSecrets];};
  partialDarwinSecrets = darwin.extendModules {modules = [partialSecrets];};
  disabledDarwinSecrets = darwin.extendModules {modules = [disableSecrets];};
  emptyDarwinSecrets = darwin.extendModules {
    modules = [{myconfig.toplevel.secrets.entries = lib.mkForce {};}];
  };
  approvedSharedSecretSource = f.outPath + "/secrets/shared.yaml";
  wholeFileSecrets = base.extendModules {
    modules = [
      {
        myconfig.toplevel.secrets.entries = lib.mkForce {
          synthetic-whole-file = {
            source = approvedSharedSecretSource;
            format = "binary";
            key = null;
            mode = "0440";
          };
        };
      }
    ];
  };
  retrievalSecretNames = ["parallel-api-key" "brave-api-key" "brave-free-api-key" "exa-api-key"];
  nushellCredentials = {
    ai-mop-api-key = "AI_MOP_API_KEY";
    iniad-id = "INIAD_ID";
    iniad-password = "INIAD_PASSWORD";
  };

  collectHomeWebRetrieval = c: let
    configDir = "${c.home.homeDirectory}/.pi/agent";
  in {
    config = builtins.fromJSON (builtins.unsafeDiscardStringContext c.home.file."${configDir}/web-retrieval.json".text);
    secretPaths = builtins.listToAttrs (map (name: {
        inherit name;
        value = c.sops.secrets.${name}.path or null;
      })
      retrievalSecretNames);
  };

  collectHomeNushell = c: {
    extraEnv = c.programs.nushell.extraEnv;
    credentials =
      lib.mapAttrs (name: variable: {
        inherit variable;
        path = c.sops.secrets.${name}.path or null;
      })
      nushellCredentials;
  };

  collectScalarDeclarations = c:
    lib.mapAttrs (_: secret: {
      source = secret.sopsFile;
      inherit (secret) format key mode;
    })
    c.sops.secrets;

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
      absentColorschemeVariant = reject {
        myconfig.colorscheme = lib.mkForce {
          name = "catppuccin";
          variant = "absent-variant";
        };
      };
      ordinaryColorschemeCollision = reject {
        myconfig.colorscheme = {
          name = "everforest";
          variant = "dark-medium";
        };
      };
    };
    generated = {
      colorschemeSelectors = {
        vividToNvf = let
          selected = base.config.myconfig.args.shared.colorscheme;
          theme = base.config.programs.nvf.settings.vim.theme;
        in
          contract "the seiran vivid selector resolves Catppuccin Macchiato through nvf" (
            selected.name
            == "catppuccin"
            && selected.variant == "macchiato"
            && theme.name == "catppuccin"
            && theme.style == "macchiato"
          );
        cleanToNvf = let
          selected = clean.config.myconfig.args.shared.colorscheme;
          theme = clean.config.programs.nvf.settings.vim.theme;
        in
          contract "the clean selector resolves Monochrome default through nvf Base16" (
            selected.name
            == "monochrome"
            && selected.variant == "default"
            && theme.name == "mini-base16"
            && theme.base16-colors.base00 == selected.palette.base00
          );
      };
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
        home = collectHomeWebRetrieval base.config;
        homePartial = collectHomeWebRetrieval partialHomeSecrets.config;
        homeDisabled = collectHomeWebRetrieval disabledHomeSecrets.config;
        darwin = collectHomeWebRetrieval darwin.config.home-manager.users.neo;
        darwinPartial = collectHomeWebRetrieval partialDarwinSecrets.config.home-manager.users.neo;
        darwinDisabled = collectHomeWebRetrieval disabledDarwinSecrets.config.home-manager.users.neo;
      };
      nushellSecrets = {
        home = collectHomeNushell base.config;
        homePartial = collectHomeNushell partialHomeSecrets.config;
        homeDisabled = collectHomeNushell disabledHomeSecrets.config;
      };
      secrets = let
        wholeFile = wholeFileSecrets.config.sops.secrets."synthetic-whole-file";
      in {
        defaultScalarDeclarations = {
          expected = {
            source = approvedSharedSecretSource;
            format = "yaml";
            mode = "0400";
          };
          projections = {
            home = collectScalarDeclarations base.config;
            darwin = collectScalarDeclarations darwin.config.home-manager.users.neo;
          };
        };
        wholeFile = {
          requested = {
            source = approvedSharedSecretSource;
            format = "binary";
            key = null;
            mode = "0440";
          };
          upstream = {
            source = wholeFile.sopsFile;
            inherit (wholeFile) format key mode;
          };
        };
        darwinRootDeclarationNames = builtins.attrNames (darwin.config.sops.secrets or {});
        darwinHeadlessActivation = let
          c = darwin.config.home-manager.users.neo;
          agent = c.launchd.agents.sops-nix;
          activation = c.home.activation.sops-nix;
        in {
          inherit (agent) domain;
          sessionType = agent.config.LimitLoadToSessionType;
          inherit (activation) after data;
        };
        darwinEmptyActivation = let
          c = emptyDarwinSecrets.config.home-manager.users.neo;
        in {
          hasLaunchAgent = builtins.hasAttr "sops-nix" c.launchd.agents;
          hasActivation = builtins.hasAttr "sops-nix" c.home.activation;
        };
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
