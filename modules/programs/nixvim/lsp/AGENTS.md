# modules/programs/nixvim/lsp/

## Server Placement

- Put schema-backed servers with store-pinned or always-available commands in `servers-store-pinned.nix`.
- Put schema-backed project-environment servers in `servers-path-gated.nix`; keep them disabled in Nix and update the executable manifest in `default.nix` with them.
- Put non-schema servers and configurations requiring Lua-only APIs in `servers-lua-only.lua`; keep their executable manifest there.
- Keep efm and its supporting packages in the exception owners. Nix, Lua, and shell formatting delegate through treefmt, and nixd stays outside `lsp-format` so Nix formatting has one owner.

## Runtime Invariants

- `activation.lua` is the sole caller of `vim.lsp.enable`; it enables path-gated, Lua-only, and exception manifests in that order.
- Arduino LSP remains Lua-owned because startup depends on project discovery and dynamic command assembly. Preserve startup visibility rather than forcing activation with extra events.
- Copilot LSP belongs to `plugins/copilot/`, not this subtree.
