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
    inherit (pkgs) lib;
    cat = pkgs.lib.getExe' pkgs.coreutils "cat";
    codexConfigMerger = pkgs.python3.withPackages (pythonPackages: [
      pythonPackages.tomlkit
    ]);
    secretPath = name: sopsSecretPaths.${name} or "/run/secrets/${name}";
    codexConfigPath =
      if homeConfig.home.preferXdgDirectories
      then "${homeConfig.xdg.configHome}/codex/config.toml"
      else "${homeConfig.home.homeDirectory}/.codex/config.toml";
    codexConfigTarget =
      if homeConfig.home.preferXdgDirectories
      then "${lib.removePrefix "${homeConfig.home.homeDirectory}/" homeConfig.xdg.configHome}/codex/config.toml"
      else ".codex/config.toml";
    codexConfigSeed = (pkgs.formats.toml {}).generate "codex-config" homeConfig.programs.codex.settings;

    codexWrapped = pkgs.symlinkJoin {
      name = "codex-wrapped";
      pname = "codex";
      version = llm-agents.codex.version or (builtins.parseDrvName llm-agents.codex.name).version;
      paths = [llm-agents.codex];
      nativeBuildInputs = [pkgs.makeWrapper];
      postBuild = ''
        wrapProgram $out/bin/codex \
          --run 'if [ ! -r "${secretPath "openrouter-api-key"}" ]; then echo "Missing readable secret file: ${secretPath "openrouter-api-key"}" >&2; exit 1; fi' \
          --run 'export OPENROUTER_API_KEY="$(${cat} "${secretPath "openrouter-api-key"}")"' \
      '';
    };
  in {
    programs.codex = {
      enable = true;
      package = codexWrapped;
      context = ./GLOBAL_AGENTS.md;
      settings = {
        multi-agent = true;
        search_tool = true;
        model_providers = {
          openrouter = {
            name = "OpenRouter";
            base_url = "https://openrouter.ai/api/v1";
            env_key = "OPENROUTER_API_KEY";
          };
        };
        profile = "full-auto";
        profiles = {
          "full-auto" = {
            model = "gpt-5.5";
            model_reasoning_effort = "medium";
            plan_mode_reasoning_effort = "medium";
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
            # model_provider = "openrouter";
            # model = "kwaipilot/kat-coder-pro:free";
          };
        };
      };
    };

    home.file.${codexConfigTarget}.enable = lib.mkForce false;

    # Codex persists project trust and small UI notices into config.toml, so the
    # target must be a writable file instead of a Home Manager store symlink.
    home.activation.codexConfigTomlMerge = homeConfig.lib.dag.entryAfter ["linkGeneration"] ''
      config_file='${codexConfigPath}'
      mkdir -p "$(dirname "$config_file")"
      ${lib.getExe codexConfigMerger} \
        ${./merge-config.py} \
        ${codexConfigSeed} \
        "$config_file" \
        "$config_file"
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
