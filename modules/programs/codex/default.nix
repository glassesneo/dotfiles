{
  delib,
  homeConfig,
  host,
  llm-agents,
  pkgs,
  sopsSecretPaths,
  ...
}:
delib.module {
  name = "programs.codex";

  options = with delib;
    moduleOptions {
      enable = boolOption host.devCoreFeatured;
      sandboxMode = enumOption ["workspace-write" "danger-full-access"] "workspace-write";
    };

  home.ifEnabled = {myconfig, ...}: let
    inherit (pkgs) lib;
    cat = pkgs.lib.getExe' pkgs.coreutils "cat";
    tomlFormat = pkgs.formats.toml {};
    codexConfigMerger = pkgs.python3.withPackages (pythonPackages: [
      pythonPackages.tomlkit
    ]);
    readAgentPrompt = name: builtins.readFile (./prompts + "/${name}.md");
    mkAgent = {
      name,
      description,
      model,
      modelReasoningEffort,
      sandboxMode,
    }:
      tomlFormat.generate "codex-agent-${name}.toml" {
        inherit name description model;
        developer_instructions = readAgentPrompt name;
        model_reasoning_effort = modelReasoningEffort;
        sandbox_mode = sandboxMode;
      };
    agents = {
      explorer = mkAgent {
        name = "explorer";
        description = "Read-only repository explorer for targeted evidence gathering and ownership mapping.";
        model = "gpt-5.4-mini";
        modelReasoningEffort = "medium";
        sandboxMode = "read-only";
      };
      internet_research = mkAgent {
        name = "internet_research";
        description = "Source-backed external researcher that writes decision-ready findings to .agents/research/.";
        model = "gpt-5.5";
        modelReasoningEffort = "medium";
        sandboxMode = "workspace-write";
      };
      reviewer = mkAgent {
        name = "reviewer";
        description = "Evidence-first reviewer that writes a scoped review report to .agents/reports/.";
        model = "gpt-5.5";
        modelReasoningEffort = "high";
        sandboxMode = "workspace-write";
      };
      tester = mkAgent {
        name = "tester";
        description = "Validation runner and failure triager that reports non-trivial failures in .agents/reports/.";
        model = "gpt-5.4-mini";
        modelReasoningEffort = "high";
        sandboxMode = myconfig.programs.codex.sandboxMode;
      };
      debugger = mkAgent {
        name = "debugger";
        description = "Command-driven bug investigator that writes a root-cause report to .agents/reports/.";
        model = "gpt-5.5";
        modelReasoningEffort = "high";
        sandboxMode = myconfig.programs.codex.sandboxMode;
      };
    };
    secretPath = name: sopsSecretPaths.${name} or "/run/secrets/${name}";
    codexConfigPath =
      if homeConfig.home.preferXdgDirectories
      then "${homeConfig.xdg.configHome}/codex/config.toml"
      else "${homeConfig.home.homeDirectory}/.codex/config.toml";
    codexConfigDirTarget =
      if homeConfig.home.preferXdgDirectories
      then "${lib.removePrefix "${homeConfig.home.homeDirectory}/" homeConfig.xdg.configHome}/codex"
      else ".codex";
    codexConfigTarget = "${codexConfigDirTarget}/config.toml";
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
        features.multi_agent = true;
        agents = {
          max_threads = 6;
          max_depth = 1;
        };
        model_providers = {
          openrouter = {
            name = "OpenRouter";
            base_url = "https://openrouter.ai/api/v1";
            env_key = "OPENROUTER_API_KEY";
          };
        };
        model = "gpt-5.5";
        model_reasoning_effort = "medium";
        plan_mode_reasoning_effort = "medium";
        approval_policy = "never";
        sandbox_mode = myconfig.programs.codex.sandboxMode;
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

    home.file =
      lib.mapAttrs' (name: source:
        lib.nameValuePair "${codexConfigDirTarget}/agents/${name}.toml" {inherit source;})
      agents
      // {
        ${codexConfigTarget}.enable = lib.mkForce false;
      };

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
