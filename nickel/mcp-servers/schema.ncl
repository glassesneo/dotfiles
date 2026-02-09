# Contract definitions for MCP server configurations
{
  # Contract for a server definition
  Server = {
    # Command identifier (resolved to path in Nix)
    command_id | String | optional,
    # URL for remote MCP servers
    url | String | optional,
    # Additional arguments for the command
    args | Array String | default = [],
    # Environment variable keys needed
    env_keys | { _ : String } | default = {},
    # Extra static environment variables
    env_static | { _ : String } | default = {},
    # Whether this server needs Node.js runtime
    needs_node | Bool | default = false,
    # Server type: stdio (command-based) or sse (URL-based)
    type | [| 'stdio, 'sse |] | default = 'stdio,
  },
}
