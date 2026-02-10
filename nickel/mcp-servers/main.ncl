# Main entry point for MCP server configuration
# Export server data for Nix consumption
# Nix will handle: path resolution, env interpolation syntax, format differences

let data = import "./servers.ncl" in
let validate = import "./validate.ncl" in
let targets = import "./targets.ncl" in
let validated =
  validate {
    servers = data.servers,
    enabled = data.enabled,
  }
in
{
  servers = validated.servers,
  enabled = validated.enabled,
  targets_meta = targets.targets_meta,
}
