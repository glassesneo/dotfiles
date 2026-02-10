# MCP servers ownership boundaries

This module splits MCP responsibilities between Nickel data modeling and Nix runtime wiring.

## Ownership model

- Nickel owns validated MCP server data and target metadata:
  - `nickel/mcp-servers/servers.ncl`
  - `nickel/mcp-servers/targets.ncl`
  - `nickel/mcp-servers/schema.ncl`
  - `nickel/mcp-servers/validate.ncl`
  - `nickel/mcp-servers/main.ncl`
- Nix owns command resolution, executable paths, env interpolation, and final module wiring:
  - `modules/programs/mcp-servers/default.nix`

## Practical rule

- Add or adjust server/target metadata in Nickel first.
- Keep path resolution and per-host executable details in Nix.
- Do not move command resolution logic into Nickel.

## Notes

- `nickel/packages/node.ncl` is informational only and is not part of active node2nix wiring.
- The hardcoded `relative-filesystem-mcp` path in Nix is a temporary host-local workaround tracked as separate ownership work.
