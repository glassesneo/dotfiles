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
        - For documentation:
          - **USE** memory MCP to document investigation results and modifications made after
          - **NEVER** summarize the results in Markdown format when you completes any coding-related task — including code modifications, technical investigations, or analysis
          - **USE** the memory MCP to store all relevant findings and changes into the preconfigured file instead
          - For all non-coding or general research tasks, **NEVER** the memory MCP and must directly display the results to the user.

        ## Technical Context
        - **Interests**: System programming
        - **Experience**: Limited web application development experience
        - **Common Tasks**: Implementing new features in existing software, refactoring
      '';
    };
  };
}
