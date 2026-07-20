local lsp = require("nvf.lsp")

lsp.setup("tinymist", "tinymist", lsp.file_root, {
  cmd = { "tinymist" },
  filetypes = { "typst" },
  settings = { formatterMode = "typstyle" },
})
