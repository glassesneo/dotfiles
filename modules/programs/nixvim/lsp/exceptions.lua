-- Runtime-only exceptions: `efm` formatting config.
local exception_executables = {
  ["efm"] = "efm-langserver",
}

vim.lsp.config.efm = {
  init_options = {
    documentFormatting = true,
    documentRangeFormatting = true,
  },
  filetypes = {
    "elm",
    "go",
    "html",
    "nim",
    "nix",
    "prisma",
    "python",
    "sh",
    "bash",
    "swift",
    "lua",
    "typst",
    "typescript",
    "typescriptreact",
    "javascript",
  },
  settings = {
    root_markers = {
      ".git/",
    },
    languages = {
      elm = {
        {
          formatCommand = "elm-format --stdin",
          formatStdin = true,
        },
      },
      go = {
        {
          formatCommand = "goimports",
          formatStdin = true,
        },
        {
          formatCommand = "gofmt",
          formatStdin = true,
        },
      },
      kotlin = {
        {
          formatCommand = "ktlint --stdin --format",
          formatStdin = true,
        },
      },
      nix = {
        {
          formatCommand = "treefmt --stdin ${INPUT}",
          formatStdin = true,
        },
      },
      nim = {
        {
          formatCommand = "nph -",
          formatStdin = true,
        },
      },
      python = {
        {
          formatCommand = "ruff format -",
          formatStdin = true,
        },
      },
      sh = {
        {
          formatCommand = "treefmt --stdin ${INPUT}",
          formatStdin = true,
        },
      },
      bash = {
        {
          formatCommand = "treefmt --stdin ${INPUT}",
          formatStdin = true,
        },
      },
      swift = {
        {
          formatCommand = "swift-format format",
          formatStdin = true,
        },
      },
      lua = {
        {
          formatCommand = "treefmt --stdin ${INPUT}",
          formatStdin = true,
        },
      },
      typst = {
        {
          formatCommand = "typstyle",
          formatStdin = true,
        },
      },
      typescript = {
        {
          formatCommand = "biome check --stdin-file-path=${INPUT} --write",
          formatStdin = true,
        },
      },
      typescriptreact = {
        {
          formatCommand = "biome check --stdin-file-path=${INPUT} --write",
          formatStdin = true,
        },
      },
    },
  },
}
