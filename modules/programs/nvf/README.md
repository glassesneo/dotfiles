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
| C | `clangd` | `clang-format` |
| Markdown | `marksman` | none |
| Typst | `tinymist` | `typstyle` |
| Python | `ty`, `ruff server` | Ruff LSP |
| Deno | `deno` | Deno LSP |
| Biome web project | `biome` | `biome` |
| Other TypeScript/JavaScript | `typescript-language-server` | TypeScript LSP |
| Nushell | `nu` | none |
| Zig | `zls` | Zig LSP |
| Lua | `emmylua_ls` | EmmyLua LSP |
| MoonBit | `moonbit-lsp` | MoonBit LSP when supported |
| Nim | `nimlangserver` | `nph` via Nim LSP |
| OCaml | `ocamllsp` | `ocamlformat` |

Web routing is exclusive. An ancestor `deno.json`/`deno.jsonc` selects Deno;
otherwise `biome.json`/`biome.jsonc` selects Biome; otherwise the TypeScript
server is used. Python uses ty for type diagnostics and Ruff LSP for lint
diagnostics and formatting. Nix remains package-backed by the existing nvf Nix
module.

Nim avoids upstream `vim.languages.nim` because that module asserts Linux-only
packaged `nimlsp`. This repo wires the Nim Treesitter grammar and a PATH-gated
`nimlangserver` client instead. Diagnostics use `nim check`
(`nim.useNimCheck`); enable style linting in the project with `--styleCheck`
in `nim.cfg` (for example `--styleCheck:hint`). Expected project toolchain
references: Nim 2.2.4 with `nph`, OCaml 5.3.0 with `ocamlformat` 0.29.0.

The `lsp/` and `formatter/` modules own their respective engines and shared
runtime policy. Each `languages/*` module owns its language-server definitions
and formatter selection.

## Smoke checks

1. Enter a project devShell, run `nvf path/to/file`, then inspect `:LspInfo` and
   `:ConformInfo`. Confirm the command shown is the bare command from the table.
2. Repeat outside the devShell. Opening and saving the same file must succeed
   without an LSP client or formatter error.
3. In separate Deno, Biome, and ordinary TypeScript fixtures, confirm exactly
   one of `denols`, `biome`, or `ts_ls` is attached.
4. Confirm `*.mbt`, `*.mbti`, and `*.mbi` report `moonbit` as `:set filetype?`
   and have an active Treesitter parser.
5. In Nim and OCaml fixtures with tools on PATH, confirm `:LspInfo` shows
   `nimlangserver` or `ocamllsp`, and that save formatting uses `nph` (Nim LSP)
   or `ocamlformat` (Conform). Repeat without those tools and confirm open/save
   still succeed.
6. Exercise `<Space><Space>`, `<Space>g`, `<Space>f`, `<Space><CR>`, and
   `<Space>z`; shared Git ignore names such as `.agents` must not appear.
7. In a temporary Git repository, edit added/changed/deleted lines and inspect
   Gitsigns. Confirm eyeliner hints stay on without taking `f`/`F`/`t`/`T`.
   Repeat `f`/`t` with the same key to advance. `*` must set the search
   pattern without moving; the following `n`/`N` animate through Cinnamon.
   `#`/`g*`/`g#` stay native plus Cinnamon.
8. With Copilot authenticated, confirm attach for a normal file in a non-Git
   directory. Confirm no attach for `~/orgfiles`, a symlink into it, sensitive
   basenames containing `env`, `conf`, `local`, or `private`, and unnamed or
   special buffers.
