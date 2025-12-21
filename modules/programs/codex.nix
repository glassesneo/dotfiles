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
        ## Required Tool Usage

        ### Code Exploration and Editing
        - **MUST** see CLAUDE.md in the project root
        - **MUST** use Kiri MCP (`mcp__kiri__context_bundle`) to explore unfamiliar codebases
          - Kiri provides intelligent code context and dependency analysis
        - **MUST** use Morph Fast Apply MCP (`mcp__morph-fast-apply__edit_file`) for large-scale edits (multiple changes, complex refactoring)
          - Fast Apply enables efficient edits with minimal context markers
        - Use normal Edit tool for small, single changes to conserve Morph's API tokens
        - When reviewing code changes, if you find specific issues, consider whether there might be underlying design problems

        ### Web Operations
        - **MUST** use Brave Search MCP or Tavily MCP for web searches
        - **MUST** use Readability MCP to fetch web page contents
        - **NEVER** use builtin web search and fetch tools

        ### CLI Tools
        - Use modern CLI alternatives:
          - `rg` instead of `grep`
          - `fd` instead of `find`
      '';
      settings = {
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
          "planning" = {
            model = "gpt-5.2-codex";
            approval_policy = "untrusted";
            sandbox_mode = "read-only";
            model_reasoning_effort = "medium";
            model_reasoning_summary = "detailed";
          };
          "full-auto" = {
            model = "gpt-5.2-codex";
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
