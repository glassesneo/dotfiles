{
  delib,
  nodePkgs,
  ...
}:
delib.module {
  name = "programs.codex";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.codex = {
      enable = true;
      package = nodePkgs."@openai/codex";
      custom-instructions = ''
        ## Tool Preferences
        - Use modern CLI alternatives:
          - `rg` instead of `grep`
          - `fd` instead of `find`
        - For web operations:
          - **MUST** use Brave Search MCP or Tavily MCP for web searches
          - **MUST** use Readability MCP to fetch web page contents
          - **NEVER** use builtin web search and fetch tools
        - Package management:
          - Use Nix exclusively as package manager
          - Run commands via `nix run nixpkgs#command-name` (note: this takes some time)
          - packages in flake.nix in the project root can be executed directly
        - Code exploration and editing:
          - **MUST** see CLAUDE.md in the project root
          - **MUST** use Kiri MCP (`mcp__kiri__context_bundle`) to explore unfamiliar codebases
          - For file editing, choose the appropriate tool:
            - **MUST** use Morph Fast Apply MCP (`mcp__morph-fast-apply__edit_file`) for large-scale edits (multiple changes, complex refactoring)
            - Use normal Edit tool for small, single changes to conserve Morph's API tokens
          - Kiri provides intelligent code context and dependency analysis
          - Fast Apply enables efficient edits with minimal context markers
      '';
      settings = {
        model_providers = {
          openrouter = {
            name = "OpenRouter";
            base_url = "https://openrouter.ai/api/v1";
            env_key = "OPENROUTER_API_KEY";
          };
        };
        profile = "full-auto";
        profiles = {
          "planning" = {
            model = "gpt-5.1-codex-max";
            approval_policy = "untrusted";
            sandbox_mode = "read-only";
            model_reasoning_effort = "medium";
            model_reasoning_summary = "detailed";
          };
          "full-auto" = {
            model = "gpt-5.1-codex-max";
            approval_policy = "never";
            sandbox_mode = "workspace-write";
            network_access = true;
            model_reasoning_effort = "medium";
            # model_provider = "openrouter";
            # model = "kwaipilot/kat-coder-pro:free";
          };
        };
      };
    };
  };
}
