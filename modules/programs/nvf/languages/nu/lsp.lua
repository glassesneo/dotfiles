local lsp = require("nvf.lsp")

lsp.setup("nushell", "nu", lsp.file_root, {
  cmd = { "nu", "--no-config-file", "--lsp" },
  filetypes = { "nu" },
})
