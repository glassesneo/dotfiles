local lsp = require("nvf.lsp")

lsp.setup("zls", "zls", lsp.file_root, {
  cmd = { "zls" },
  filetypes = { "zig", "zir" },
  settings = { zls = { enable_inlay_hints = true, warn_style = true } },
})
