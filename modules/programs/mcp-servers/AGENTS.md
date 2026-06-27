# modules/programs/mcp-servers/

## MCP Architecture

Centralized MCP server definitions and runtime wiring live in a single Nix file:
- @modules/programs/mcp-servers/default.nix (typed server catalog, target adapter metadata, validation assertions, and rendering)

### Ownership Model

- **Shared server catalog** (`programs.mcp-servers-nix.catalog`): centralized in this module. Add or modify server definitions here.
- **Per-client membership** (`programs.mcp-servers-nix.targets.<target>`): owned by each client module via `myconfig.ifEnabled`. To change which servers a client uses, edit the client module:
  - Claude Code: @modules/programs/claude-code/default.nix
  - Claude Desktop: @modules/programs/claude-desktop.nix
  - Codex: @modules/programs/codex/default.nix
  - OpenCode: @modules/programs/opencode/default.nix

Each AI tool uses a separate memory file under `$XDG_DATA_HOME` to prevent conflicts (e.g., `claudecode_memory.json`, `opencode_memory.json`, `crush_memory.json`).

## Secrets

- For env-var-only MCP servers, inject secrets through wrapper commands in @modules/programs/mcp-servers/default.nix.
- Read secret values from `config.sops.secrets.<name>.path`; do not rely on global session exports.
