# modules/programs/mcp-servers/

## MCP Architecture

Centralized MCP server definitions live in:
- @modules/programs/mcp-servers/default.nix (Nix glue)
- @nickel/mcp-servers/servers.ncl (single source of truth for server configs)

Each AI tool uses a separate memory file under `$XDG_DATA_HOME` to prevent conflicts (e.g., `claudecode_memory.json`, `opencode_memory.json`, `crush_memory.json`).

**IMPORTANT**: When adding a new MCP server, add it to `nickel/mcp-servers/servers.ncl`. Do not scatter MCP configs across individual tool modules.

## Secrets

- For env-var-only MCP servers, inject secrets through wrapper commands in @modules/programs/mcp-servers/default.nix.
- Read secret values from `config.sops.secrets.<name>.path`; do not rely on global session exports.
