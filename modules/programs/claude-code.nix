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
        # Development Environment

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

        ## Communication Preferences
        - Provide formal and detailed responses
        - Follow project-local CLAUDE.md files for code style conventions

        ## Tool Preferences
        - Use modern CLI alternatives:
          - `rg` instead of `grep`
          - `fd` instead of `find`
        - For web operations:
          - **MUST** use Brave Search MCP or Tavily MCP for web searches
          - **MUST** use Readability MCP to fetch web page contents
          - **NEVER** builtin web search and fetch tools
        - Package management:
          - Use Nix exclusively as package manager
          - Run commands via `nix run nixpkgs#command-name` (note: this takes some time)
        - Code exploration and editing:
          - **MUST** use Kiri MCP (`mcp__kiri__context_bundle`) to explore unfamiliar codebases
          - **MUST** prioritize Morph Fast Apply MCP (`mcp__morph-fast-apply__edit_file`) when editing files
          - Kiri provides intelligent code context and dependency analysis
          - Fast Apply enables efficient edits with minimal context markers

        ## Technical Context
        - **Interests**: System programming
        - **Experience**: Limited web application development experience
        - **Common Tasks**: Implementing new features in existing software, refactoring
      '';
    };
  };
}