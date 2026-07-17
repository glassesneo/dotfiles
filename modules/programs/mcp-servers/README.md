# MCP servers ownership boundaries

This module keeps MCP server data and runtime wiring in a single Nix file.

## Ownership model

- **Shared server catalog** — typed option `programs.mcp-servers.catalog` in `modules/programs/mcp-servers/default.nix`. Each entry defines a server's command/URL, args, env, and behavior.
- **Per-client membership** — typed list options `programs.mcp-servers.targets.<target>` contributed by each client module via `myconfig.ifEnabled`:
  - `modules/programs/opencode/default.nix` → `targets.opencode`
- **Target adapter metadata** — centralized in `modules/programs/mcp-servers/default.nix` (env format, type policies, command behavior per target).

## Practical rules

- To add or adjust a server definition: edit `catalog` defaults in `modules/programs/mcp-servers/default.nix`.
- To change which servers a client uses: edit the `myconfig.ifEnabled.programs.mcp-servers.targets.<target>` list in the client module.
- Keep path resolution, wrappers, and per-host executable details in the MCP module file.

## Authenticated remote (hosted) MCP servers

Remote MCP servers that require bearer-token auth use the `auth_secret` field:

```nix
my-remote-server = {
  url = "https://api.example.com/mcp";
  auth_secret = "my-key";  # SOPS secret name from config.sops.secrets
};
```

Auth headers are rendered per target using runtime substitution — no plaintext secrets in generated config:

- **OpenCode**: `"Bearer {file:/path/to/secret}"` — file-content substitution via `config.sops.secrets.<key>.path`.

Secrets must exist in `modules/toplevel/secrets.nix` and be bound in the host secrets file.

## Notes

- Validation assertions (url xor command_id and enabled-server references) are enforced as Nix assertions in the same file.
