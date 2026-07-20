local lsp = require("nvf.lsp")

lsp.setup("clangd", "clangd", lsp.file_root, {
  cmd = { "clangd", "--clang-tidy" },
  filetypes = { "c", "cpp", "objc", "objcpp" },
})
