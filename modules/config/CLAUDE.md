# modules/config/

## Constants

User metadata is centralized in @modules/config/constants.nix.
Use `constants.username`, `constants.userfullname`, `constants.useremail` instead of literals.

## Kiri Wrapper

Kiri MCP uses a wrapper to avoid tree-sitter download issues, implemented in:
- @modules/config/node2nix.nix

Key behavior:
- Wrapper runs `kiri-mcp-server` via `npx` with explicit `PATH`.
- Kiri writes its index to `.kiri/index.duckdb` at repo root.
- Watch mode uses `--watch` and keeps the DuckDB index in `.kiri/`.

## Node Package Management

When modifying `node2nix/node-packages.json`:
```bash
cd node2nix
nix-shell -p node2nix --run "node2nix --input node-packages.json --output node-packages.nix --composition default.nix"
```
