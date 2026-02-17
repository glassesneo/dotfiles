# modules/config/

## Constants

User metadata is centralized in @modules/config/constants.nix.
Use `constants.username`, `constants.userfullname`, `constants.useremail` instead of literals.

## Kiri Wrapper

Kiri MCP uses a wrapper to avoid tree-sitter download issues, implemented in:
- @modules/config/node-packages.nix

Key behavior:
- Wrapper runs `kiri-mcp-server` via `npx` with explicit `PATH`.
- Kiri writes its index to `.kiri/index.duckdb` at repo root.
- Watch mode uses `--watch` and keeps the DuckDB index in `.kiri/`.

## MCP Node Package Management (bun2nix)

MCP server npm packages are managed via bun2nix in `node-packages/`.
To add, update, or remove packages:
```bash
cd node-packages
# Edit package.json
bun install && bun2nix -o bun.nix
git add package.json bun.lock bun.nix
nh home switch
```
