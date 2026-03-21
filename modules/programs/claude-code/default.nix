{
  delib,
  llm-agents,
  pkgs,
  sopsSecretPaths,
  ...
}:
delib.module {
  name = "programs.claude-code";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    cat = pkgs.lib.getExe' pkgs.coreutils "cat";
    readAgentPrompt = name: builtins.readFile (./prompts + "/${name}.md");
    secretPath = name: sopsSecretPaths.${name} or "/run/secrets/${name}";

    claudeCodeWrapped = pkgs.symlinkJoin {
      name = "claude-code-wrapped";
      paths = [llm-agents.claude-code];
      nativeBuildInputs = [pkgs.makeWrapper];
      postBuild = ''
        for bin in "$out/bin/claude" "$out/bin/claude-code"; do
          if [ -f "$bin" ]; then
            wrapProgram "$bin" \
              --run 'if [ ! -r "${secretPath "claude-code-oauth-token"}" ]; then echo "Missing readable secret file: ${secretPath "claude-code-oauth-token"}" >&2; exit 1; fi' \
              --run 'export CLAUDE_CODE_OAUTH_TOKEN="$(${cat} "${secretPath "claude-code-oauth-token"}")"' \
              --run 'if [ -r "${secretPath "zai-api-key"}" ]; then export ZAI_API_KEY="$(${cat} "${secretPath "zai-api-key"}")"; fi'
          fi
        done
      '';
    };
  in {
    programs.claude-code = {
      enable = true;
      package = claudeCodeWrapped;
      settings = {
        model = "opus[1M]";
        autoMemoryEnabled = false;
        skipDangerousModePermissionPrompt = true;
        skipAutoPermissionPrompt = true;
        automode = true;
        permissions = {
          defaultMode = "auto";
          allow = [
            "Skill(tmux-runner)"
            "mcp__context7__resolve-library-id"
            "mcp__context7__get-library-docs"
            "mcp__deepwiki__*"
            "mcp__brave-search__brave_web_search"
            "mcp__readability__read_url_content_as_markdown"
          ];
        };
        sandbox = {
          enabled = true;
          autoAllowBashIfSandboxed = true;
        };

        env = {
          DISABLE_AUTOUPDATER = "1";
          ENABLE_TOOL_SEARCH = true;
          ENABLE_LSP_TOOL = true;
          CLAUDE_CODE_ENABLE_TASKS = true;
        };
      };
      agents = {
        internet-research = readAgentPrompt "internet-research";
        code_reviewer = readAgentPrompt "code_reviewer";
        tester = readAgentPrompt "tester";
      };
      memory.text = builtins.readFile ./GLOBAL_CLAUDE.md;
    };
  };

  # Default MCP server membership for Claude Code.
  myconfig.ifEnabled.programs.mcp-servers-nix.targets.claude_code = [
    "brave-search"
    "deepwiki"
    "readability"
    "context7"
  ];
}
