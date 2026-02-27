# MCP servers ownership boundaries

This module keeps MCP server data and runtime wiring in a single Nix file.

## Ownership model

- Nix owns all MCP server data, target metadata, validation assertions, and runtime wiring:
  - `modules/programs/mcp-servers/default.nix`

## Practical rule

- Add or adjust server/target metadata directly in `modules/programs/mcp-servers/default.nix`:
  - `servers` attrset: per-server config (command_id/url, args, env_keys, env_static, needs_node)
  - `enabled` attrset: list of enabled server names per target
  - `targetsMeta` attrset: per-target adapter config (env format, type policies, command behavior)
- Keep path resolution and per-host executable details in the same file.

## Notes

- Validation assertions (url xor command_id, required targets, enabled-server references, needs_node rules) are enforced as Nix assertions in the same file.
- `nickel/packages/node.ncl` is informational only and is not part of any active pipeline.
