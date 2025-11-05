{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.opencode";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.opencode = {
      enable = true;
      settings = {
        theme = "transparent-catppuccin";
        autoshare = false;
        autoupdate = false;
      };
      themes = {
        transparent-catppuccin = ./themes/transparent-catppuccin.json;
      };
      rules = ''
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

        ## Technical Context
        - **Interests**: System programming
        - **Experience**: Limited web application development experience
        - **Common Tasks**: Implementing new features in existing software, refactoring
      '';
    };
  };
}
