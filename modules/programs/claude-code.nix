{
  delib,
  nodePkgs,
  ...
}:
delib.module {
  name = "programs.claude-code";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.claude-code = {
      enable = true;
      package = nodePkgs."@anthropic-ai/claude-code";
      settings = {
        env = {
          DISABLE_AUTOUPDATER = "1";
        };
      };
      memory.text = ''
        # CRITICAL DIRECTIVES

        ## Development Methodology (VERY IMPORTANT)
        - **MUST** use Test-Driven Development (TDD) approach for all code changes
        - Write tests first, then implement features to pass those tests
        - Ensure test coverage for new functionality and bug fixes
        - Run tests frequently during development

        ## AI Assistant Delegation
        - **Codex MCP** (`mcp__codex__codex`): Best for code reading, analysis, and planning refactoring
          - Use Codex to understand unfamiliar codebases and create implementation plans
          - Treat Codex like a subagent for exploration and planning tasks
          - **Limitation**: Codex is NOT suitable for implementing new features (use Claude Code for implementation)
          - **NEVER** specify `reasoning-effort = "high"` when calling Codex MCP
        - After Codex provides a plan, implement features yourself using TDD approach

        ## Required Tool Usage

        ### Code Exploration and Editing
        - **MUST** use Kiri MCP (`mcp__kiri__context_bundle`) to explore unfamiliar codebases
          - Kiri provides intelligent code context and dependency analysis
        - For file editing, choose the appropriate tool:
          - **MUST** use Morph Fast Apply MCP (`mcp__morph-fast-apply__edit_file`) for large-scale edits (multiple changes, complex refactoring)
          - Use normal Edit tool for small, single changes to conserve Morph's API tokens
          - Fast Apply enables efficient edits with minimal context markers

        ### Web Operations
        - **MUST** use Brave Search MCP or Tavily MCP for web searches
        - **MUST** use Readability MCP to fetch web page contents
        - **NEVER** use builtin web search and fetch tools

        ### CLI Tools
        - Use modern CLI alternatives:
          - `rg` instead of `grep`
          - `fd` instead of `find`

        ### Package Management
        - Use Nix exclusively as package manager
        - Run commands via `nix run nixpkgs#command-name` (note: this takes some time)

        # DEVELOPMENT ENVIRONMENT

        ## Languages & Technologies
        - **Personal Projects**: Zig, TypeScript
        - **University**: Python
        - **Development Environment**: Nix
        - **Neovim Configuration**: Lua

        ## System & Tools
        - **OS**: macOS (Darwin)
        - **Editor**: Neovim
        - **Shell**: zsh (default), nushell
        - **Terminal**: Ghostty
        - **Multiplexer**: Zellij
        - **Package Manager**: Nix only

        ## Technical Context
        - **Interests**: System programming
        - **Experience**: Limited web application development experience
        - **Common Tasks**: Implementing new features in existing software, refactoring

        # COMMUNICATION PREFERENCES
        - Provide formal and detailed responses
        - Follow project-local CLAUDE.md files for code style conventions
      '';
    };
  };
}