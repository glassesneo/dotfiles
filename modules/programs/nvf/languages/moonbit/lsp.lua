local lsp = require("nvf.lsp")

local function moonbit_root(path)
  return lsp.nearest_marker(path, { "moon.mod.json" }) or lsp.file_root(path)
end

lsp.setup("moonbit", "moonbit-lsp", moonbit_root, {
  cmd = { "moonbit-lsp" },
  filetypes = { "moonbit" },
})
