local lsp = require("nvf.lsp")

lsp.setup("bashls", "bash-language-server", lsp.file_root, {
  cmd = { "bash-language-server", "start" },
  filetypes = { "bash", "sh" },
})
