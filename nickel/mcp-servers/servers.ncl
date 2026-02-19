# Single source of truth for all MCP server definitions
let { Server, .. } = import "./schema.ncl" in

{
  # All available MCP servers
  servers | { _ : Server } = {
    # Search and web content servers
    brave-search = {
      command_id = "brave-search-mcp",
      env_keys = { BRAVE_API_KEY = "BRAVE_API_KEY" },
    },

    deepwiki = {
      url = "https://mcp.deepwiki.com/mcp",
    },

    readability = {
      command_id = "readability-mcp",
      needs_node = true,
    },

    tavily = {
      command_id = "tavily-mcp",
      env_keys = { TAVILY_API_KEY = "TAVILY_API_KEY" },
    },

    # Browser and development tools
    chrome-devtools = {
      command_id = "chrome-devtools-mcp",
    },

    # Code and file manipulation
    morph-fast-apply = {
      command_id = "morph-fast-apply-mcp",
      env_keys = { MORPH_API_KEY = "MORPH_API_KEY" },
      env_static = { ALL_TOOLS = "false" },
    },

    kiri = {
      command_id = "kiri-mcp",
      args = ["--repo", ".", "--db", ".kiri/index.duckdb", "--watch"],
    },

    # AI assistants
    codex = {
      command_id = "codex-mcp",
      args = ["mcp-server"],
    },

    context7 = {
      command_id = "context7-mcp",
    },

    # Maps

    # Custom/local servers
    relative-filesystem = {
      command_id = "relative-filesystem-mcp",
    },
  },

  # Lists of servers enabled for each target
  # This allows different subsets per tool while keeping data centralized
  enabled = {
    claude_code = [
      "brave-search",
      "deepwiki",
      "readability",
      "morph-fast-apply",
      "kiri",
      "codex",
      "context7",
    ],

    claude_desktop = [
      "brave-search",
      "readability",
      "chrome-devtools",
      "context7",
    ],

    codex = [
      "brave-search",
      "deepwiki",
      "readability",
      "chrome-devtools",
      "morph-fast-apply",
      "kiri",
      "context7",
    ],

    opencode = [
      "brave-search",
      "deepwiki",
      "readability",
      "kiri",
      "context7",
    ],
  },
}
