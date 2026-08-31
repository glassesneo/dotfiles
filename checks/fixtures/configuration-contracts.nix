{
  configurationSource,
  mode ? "normal",
}: let
  f = builtins.getFlake configurationSource;
  lib = f.inputs.nixpkgs.lib;
  base = f.homeConfigurations."neo@seiran";
  clean = f.homeConfigurations."neo@seiran-clean";
  darwin = f.darwinConfigurations.seiran;

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
  emergencyDisabled = base.extendModules {
    modules = [{myconfig.programs.pi-coding-agent.emergency.enable = false;}];
  };
  questionEnabled = base.extendModules {
    modules = [{myconfig.programs.pi-coding-agent.question.enable = lib.mkForce true;}];
  };
  questionDisabled = base.extendModules {
    modules = [{myconfig.programs.pi-coding-agent.question.enable = lib.mkForce false;}];
  };
  artifactDisabled = base.extendModules {
    modules = [
      {
        myconfig.programs.pi-coding-agent.question.enable = lib.mkForce false;
        myconfig.programs.pi-coding-agent.agent_artifact.enable = lib.mkForce false;
      }
    ];
  };
  questionKeybindingOverride = base.extendModules {
    modules = [
      {
        myconfig.programs.pi-coding-agent.question.enable = lib.mkForce true;
        myconfig.programs.pi-coding-agent.keybindings.overrides.question."choice.select-and-note" = ["f12"];
      }
    ];
  };
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

  collectEmergency = home: let
    c = home.config;
    cfg = c.myconfig.programs.pi-coding-agent;
    emergencyDir = "${c.home.homeDirectory}/.pi/emergency-agent";
    emergencyFileNames = builtins.filter (name: builtins.match "${emergencyDir}/.*" name != null) (builtins.attrNames c.home.file);
    linkedFileNames = builtins.filter (name: let
      file = c.home.file.${name};
    in
      file.text == null && file ? source && file.source ? drvPath)
    emergencyFileNames;
  in {
    packages = builtins.listToAttrs (map (package: {
        name = package.pname or package.name;
        value = {
          path = toString package;
          drvPath = builtins.unsafeDiscardStringContext package.drvPath;
        };
      }) (builtins.filter
        (package: builtins.elem (package.pname or package.name) ["pi-emergency" "pi-emergency-full"])
        c.home.packages));
    links = builtins.listToAttrs (map (name: let
        fileName = lib.removePrefix "${emergencyDir}/" name;
        source = c.home.file.${name}.source;
      in {
        name = fileName;
        value = {
          drvPath = builtins.unsafeDiscardStringContext source.drvPath;
          source = toString source;
          target = "${cfg.configDir}/${fileName}";
        };
      })
      linkedFileNames);
  };

  disabledConfig = emergencyDisabled.config;
  disabledDir = "${disabledConfig.home.homeDirectory}/.pi/emergency-agent";
in
  if mode != "normal"
  then throw "unknown configuration contract fixture mode: ${mode}"
  else {
    schemaVersion = 1;
    generated = {
      colorschemeSelectors = {
        vividToNvf = let
          selected = base.config.myconfig.args.shared.colorscheme;
          theme = base.config.programs.nvf.settings.vim.theme;
        in
          contract "the vivid selector is translated by the nvf owner" (
            theme.name
            == selected.name
            && theme.style
            == (
              if selected.name == "everforest"
              then lib.removePrefix "dark-" selected.variant
              else selected.variant
            )
          );
        cleanToNvf = let
          selected = clean.config.myconfig.args.shared.colorscheme;
          theme = clean.config.programs.nvf.settings.vim.theme;
        in
          contract "the generic selector palette is translated through nvf Base16" (
            theme.name
            == "mini-base16"
            && theme.base16-colors.base00 == selected.palette.base00
          );
      };
      pi = {
        enabledQuestion = {
          packageSources = questionEnabled.config.programs.pi-coding-agent.settings.packages;
          extensionPaths = questionEnabled.config.programs.pi-coding-agent.settings.extensions;
          modes = builtins.fromJSON (builtins.unsafeDiscardStringContext questionEnabled.config.home.file."${questionEnabled.config.home.homeDirectory}/.pi/agent/agent-modes.json".text);
        };
        disabledQuestion = {
          packageSources = questionDisabled.config.programs.pi-coding-agent.settings.packages;
          extensionPaths = questionDisabled.config.programs.pi-coding-agent.settings.extensions;
          modes = builtins.fromJSON (builtins.unsafeDiscardStringContext questionDisabled.config.home.file."${questionDisabled.config.home.homeDirectory}/.pi/agent/agent-modes.json".text);
        };
        artifactDisabled = {
          packageSources = artifactDisabled.config.programs.pi-coding-agent.settings.packages;
          runtimeLinks = {
            extensionsSource = builtins.hasAttr "${artifactDisabled.config.home.homeDirectory}/.pi/agent/extensions-runtime/extensions_src" artifactDisabled.config.home.file;
            nodeModules = builtins.hasAttr "${artifactDisabled.config.home.homeDirectory}/.pi/agent/extensions-runtime/node_modules" artifactDisabled.config.home.file;
          };
        };
        catalog = builtins.fromJSON (builtins.unsafeDiscardStringContext base.config.home.file."${base.config.home.homeDirectory}/.pi/agent/role-catalog.json".text);
        profiles = builtins.fromJSON (builtins.unsafeDiscardStringContext base.config.home.file."${base.config.home.homeDirectory}/.pi/agent/execution-profiles.json".text);
        orchestration = builtins.fromJSON (builtins.unsafeDiscardStringContext base.config.home.file."${base.config.home.homeDirectory}/.pi/agent/orchestration.json".text);
        settings = base.config.programs.pi-coding-agent.settings;
        models = builtins.fromJSON (builtins.unsafeDiscardStringContext base.config.home.file."${base.config.home.homeDirectory}/.pi/agent/models.json".text);
        extensionKeybindings = builtins.fromJSON (builtins.unsafeDiscardStringContext aliasOverride.config.home.file."${aliasOverride.config.home.homeDirectory}/.pi/agent/extension-keybindings.json".text);
        decisionUi = builtins.fromJSON (builtins.unsafeDiscardStringContext questionKeybindingOverride.config.home.file."${questionKeybindingOverride.config.home.homeDirectory}/.pi/agent/pi-decision-ui.json".text);
        navigationTmux = navigation.config.programs.tmux.extraConfig;
        darwinTmux = darwin.config.home-manager.users.neo.programs.tmux.extraConfig;
      };
      webRetrieval = {
        homePartial = collectHomeWebRetrieval partialHomeSecrets.config;
        homeDisabled = collectHomeWebRetrieval disabledHomeSecrets.config;
        darwinPartial = collectHomeWebRetrieval partialDarwinSecrets.config.home-manager.users.neo;
        darwinDisabled = collectHomeWebRetrieval disabledDarwinSecrets.config.home-manager.users.neo;
      };
      nushellSecrets = {
        homePartial = collectHomeNushell partialHomeSecrets.config;
        homeDisabled = collectHomeNushell disabledHomeSecrets.config;
      };
      secrets = let
        wholeFile = wholeFileSecrets.config.sops.secrets."synthetic-whole-file";
      in {
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
          packages =
            builtins.filter
            (name: builtins.elem name ["pi-emergency" "pi-emergency-full"])
            (map (package: package.pname or package.name) disabledConfig.home.packages);
          emergencyFiles = builtins.filter (name: builtins.match "${disabledDir}/.*" name != null) (builtins.attrNames disabledConfig.home.file);
        };
      };
    };
  }
