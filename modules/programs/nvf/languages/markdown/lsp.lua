local lsp = require("nvf.lsp")

lsp.setup("marksman", "marksman", lsp.file_root, {
  cmd = { "marksman", "server" },
  filetypes = { "markdown", "markdown.mdx" },
})
