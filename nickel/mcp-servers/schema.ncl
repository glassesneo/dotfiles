# Contract definitions for MCP server configurations
{
  # Contract for a server definition
  Server =
    let BaseServer = {
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
    } in

    let SourceXorValidator =
      std.contract.from_validator (fun server =>
        if !std.is_record server then
          'Ok
        else
          let has_url = std.record.has_field "url" server in
          let has_command_id = std.record.has_field "command_id" server in
          if has_url && has_command_id then
            'Error {
              message = "server must define exactly one of `url` or `command_id` (both found)",
              notes = ["Use `url` for remote servers or `command_id` for local command-based servers."],
            }
          else if !has_url && !has_command_id then
            'Error {
              message = "server must define exactly one of `url` or `command_id` (neither found)",
              notes = ["Add `url` for a remote server, or add `command_id` for a local server."],
            }
          else
            'Ok
      ) in

    std.contract.all_of [BaseServer, SourceXorValidator],
}
