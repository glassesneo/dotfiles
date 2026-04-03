{
  delib,
  homeConfig,
  llm-agents,
  pkgs,
  sopsSecretPaths,
  ...
}:
delib.module {
  name = "programs.codex";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    cat = pkgs.lib.getExe' pkgs.coreutils "cat";
    codexConfigBackupPath = "/tmp/codex-config-pre-switch-${homeConfig.home.username}.toml";
    codexConfigMergeScript = pkgs.replaceVars ./merge-config.sh {
      backupFile = pkgs.lib.escapeShellArg codexConfigBackupPath;
      configFile = pkgs.lib.escapeShellArg codexConfigPath;
      mergeNuScript = pkgs.lib.escapeShellArg (toString ./merge-config.nu);
      nu = pkgs.lib.escapeShellArg (pkgs.lib.getExe pkgs.nushell);
    };
    secretPath = name: sopsSecretPaths.${name} or "/run/secrets/${name}";
    codexConfigPath =
      if homeConfig.home.preferXdgDirectories
      then "${homeConfig.xdg.configHome}/codex/config.toml"
      else "${homeConfig.home.homeDirectory}/.codex/config.toml";

    codexWrapped = pkgs.symlinkJoin {
      name = "codex-wrapped";
      pname = "codex";
      version = llm-agents.codex.version or (builtins.parseDrvName llm-agents.codex.name).version;
      paths = [llm-agents.codex];
      nativeBuildInputs = [pkgs.makeWrapper];
      postBuild = ''
        wrapProgram $out/bin/codex \
          --run 'if [ ! -r "${secretPath "openrouter-api-key"}" ]; then echo "Missing readable secret file: ${secretPath "openrouter-api-key"}" >&2; exit 1; fi' \
          --run 'if [ ! -r "${secretPath "cerebras-api-key"}" ]; then echo "Missing readable secret file: ${secretPath "cerebras-api-key"}" >&2; exit 1; fi' \
          --run 'if [ ! -r "${secretPath "ai-mop-api-key"}" ]; then echo "Missing readable secret file: ${secretPath "ai-mop-api-key"}" >&2; exit 1; fi' \
          --run 'export OPENROUTER_API_KEY="$(${cat} "${secretPath "openrouter-api-key"}")"' \
          --run 'export CEREBRAS_API_KEY="$(${cat} "${secretPath "cerebras-api-key"}")"' \
          --run 'export AI_MOP_API_KEY="$(${cat} "${secretPath "ai-mop-api-key"}")"'
      '';
    };
  in {
    programs.codex = {
      enable = true;
      package = codexWrapped;
      # custom-instructions = builtins.readFile ./INSTRUCTIONS.md;
      settings = {
        multi-agent = true;
        search_tool = true;
        model_providers = {
          openrouter = {
            name = "OpenRouter";
            base_url = "https://openrouter.ai/api/v1";
            env_key = "OPENROUTER_API_KEY";
          };
          cerebras = {
            name = "Cerebras";
            base_url = "https://api.cerebras.ai/v1";
            env_key = "CEREBRAS_API_KEY";
          };
          aimop = {
            name = "AI MOP";
            base_url = "https://api.openai.iniad.org/api/v1";
            env_key = "AI_MOP_API_KEY";
          };
        };
        profile = "full-auto";
        profiles = {
          "full-auto" = {
            model = "gpt-5.4";
            approval_policy = "never";
            sandbox_mode = "workspace-write";
            sandbox_workspace_write.network_access = true;
            sandbox_workspace_write.writable_roots = [
              "/tmp/agent-browser"
              "/tmp/agent-browser-run"
            ];
            network_access = true;
            shell_environment_policy.experimental_use_profile = true;
            shell_environment_policy.set = {
              AGENT_BROWSER_HOME = "/tmp/agent-browser";
              PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
              XDG_RUNTIME_DIR = "/tmp/agent-browser-run";
              XDG_CACHE_HOME = "/tmp/agent-browser/cache";
              XDG_DATA_HOME = "/tmp/agent-browser/data";
              XDG_STATE_HOME = "/tmp/agent-browser/state";
            };
            model_reasoning_effort = "medium";
            # model_provider = "openrouter";
            # model = "kwaipilot/kat-coder-pro:free";
          };
          "agent-browser" = {
            model = "gpt-5.4";
            approval_policy = "on-request";
            sandbox_mode = "workspace-write";
            sandbox_workspace_write.network_access = true;
            sandbox_workspace_write.writable_roots = [
              "/tmp/agent-browser"
              "/tmp/agent-browser-run"
            ];
            network_access = true;
            shell_environment_policy.experimental_use_profile = true;
            shell_environment_policy.set = {
              AGENT_BROWSER_HOME = "/tmp/agent-browser";
              PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
              XDG_RUNTIME_DIR = "/tmp/agent-browser-run";
              XDG_CACHE_HOME = "/tmp/agent-browser/cache";
              XDG_DATA_HOME = "/tmp/agent-browser/data";
              XDG_STATE_HOME = "/tmp/agent-browser/state";
            };
            model_reasoning_effort = "medium";
          };
        };
      };
    };

    # Codex persists project trust into config.toml. Capture the runtime file
    # before Home Manager relinks the declarative seed, then merge runtime-only
    # tables such as projects.* back into the fresh seed TOML.
    home.activation.codexConfigTomlPrepare = homeConfig.lib.dag.entryBefore ["checkLinkTargets"] ''
      config_file='${codexConfigPath}'
      backup_file='${codexConfigBackupPath}'
      hm_backup_ext="''${HOME_MANAGER_BACKUP_EXT:-home_manager_backup}"
      hm_backup_file="$config_file.$hm_backup_ext"

      rm -f "$backup_file"
      rm -f "$hm_backup_file"
      if [ -f "$config_file" ] && [ ! -L "$config_file" ]; then
        cp "$config_file" "$backup_file"
      fi
    '';

    home.activation.codexConfigTomlMerge = homeConfig.lib.dag.entryAfter ["linkGeneration"] ''
      ${builtins.readFile codexConfigMergeScript}
    '';
  };

  # Default MCP server membership for Codex.
  myconfig.ifEnabled.programs.mcp-servers-nix.targets.codex = [
    "brave-search"
    "deepwiki"
    "readability"
    "context7"
  ];
}
