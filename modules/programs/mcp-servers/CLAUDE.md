# modules/programs/mcp-servers/

## MCP Architecture

Centralized MCP server definitions live in a single Nix file:
- @modules/programs/mcp-servers/default.nix (server data, target metadata, validation, and runtime wiring)

Each AI tool uses a separate memory file under `$XDG_DATA_HOME` to prevent conflicts (e.g., `claudecode_memory.json`, `opencode_memory.json`, `crush_memory.json`).

**IMPORTANT**: When adding a new MCP server, edit `servers` and `enabled` in `modules/programs/mcp-servers/default.nix`. Do not scatter MCP configs across individual tool modules.

## Secrets

- For env-var-only MCP servers, inject secrets through wrapper commands in @modules/programs/mcp-servers/default.nix.
- Read secret values from `config.sops.secrets.<name>.path`; do not rely on global session exports.
