# nvf project-tool contract

The nvf wrapper owns editor configuration and parsers. Except for the existing
Nix integration, language servers and formatters are intentionally not added to
the wrapper closure. Launch `nvf` from a project devShell (or another
declarative environment) that provides the commands needed by that project.
Missing commands are supported: the corresponding client or formatter remains
inactive without preventing the editor from starting.

| Language/project | LSP command | Formatter command |
|---|---|---|
| Shell | `bash-language-server` | `shfmt` |
| Markdown | `marksman` | none |
| Typst | `tinymist` | `typstyle` |
| Deno | `deno` | Deno LSP |
| Biome web project | `biome` | `biome` |
| Other TypeScript/JavaScript | `typescript-language-server` | TypeScript LSP |
| Nushell | `nu` | none |
| Zig | `zls` | Zig LSP |
| Lua | `emmylua_ls` | EmmyLua LSP |
| MoonBit | `moonbit-lsp` | MoonBit LSP when supported |

Web routing is exclusive. An ancestor `deno.json`/`deno.jsonc` selects Deno;
otherwise `biome.json`/`biome.jsonc` selects Biome; otherwise the TypeScript
server is used. Nix remains package-backed by the existing nvf Nix module.

## Smoke checks

1. Enter a project devShell, run `nvf path/to/file`, then inspect `:LspInfo` and
   `:ConformInfo`. Confirm the command shown is the bare command from the table.
2. Repeat outside the devShell. Opening and saving the same file must succeed
   without an LSP client or formatter error.
3. In separate Deno, Biome, and ordinary TypeScript fixtures, confirm exactly
   one of `denols`, `biome`, or `ts_ls` is attached.
4. Confirm `*.mbt`, `*.mbti`, and `*.mbi` report `moonbit` as `:set filetype?`
   and have an active Treesitter parser.
5. Exercise `<Space><Space>`, `<Space>g`, `<Space>f`, `<Space><CR>`, and
   `<Space>z`; shared Git ignore names such as `.agents` must not appear.
6. In a temporary Git repository, edit added/changed/deleted lines and inspect
   Gitsigns. Exercise `f`/`t` repetition and `*`, `#`, `g*`, `g#` in normal,
   visual, and operator-pending modes.
7. With Copilot authenticated, confirm attach for a normal file in a non-Git
   directory. Confirm no attach for `~/orgfiles`, a symlink into it, sensitive
   basenames containing `env`, `conf`, `local`, or `private`, and unnamed or
   special buffers.
