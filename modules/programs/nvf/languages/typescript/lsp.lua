local lsp = require("nvf.lsp")
local typescript = require("nvf.typescript")

local filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" }

lsp.setup("denols", "deno", typescript.root("deno"), {
  cmd = { "deno", "lsp" },
  filetypes = filetypes,
  init_options = { lint = true, unstable = true },
})

lsp.setup("biome", "biome", typescript.root("biome"), {
  cmd = { "biome", "lsp-proxy" },
  filetypes = filetypes,
})

lsp.setup("ts_ls", "typescript-language-server", typescript.root("typescript"), {
  cmd = { "typescript-language-server", "--stdio" },
  filetypes = filetypes,
})
