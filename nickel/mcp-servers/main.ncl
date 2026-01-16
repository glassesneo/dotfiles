# Main entry point for MCP server configuration
# Export server data for Nix consumption
# Nix will handle: path resolution, env interpolation syntax, format differences

let data = import "./servers.ncl" in

{
  servers = data.servers,
  enabled = data.enabled,
}
