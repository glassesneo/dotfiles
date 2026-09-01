local lsp = require("nvf.lsp")

local function nim_root(path)
  local dir = vim.fs.dirname(path)
  local nimble = vim.fs.find(function(name)
    return name:match("%.nimble$") ~= nil
  end, { path = dir, upward = true, type = "file", limit = 1 })[1]
  if nimble then
    return vim.fs.dirname(nimble)
  end
  return lsp.nearest_marker(path, { ".git" }) or lsp.file_root(path)
end

lsp.setup("nim_langserver", "nimlangserver", nim_root, {
  cmd = { "nimlangserver" },
  filetypes = { "nim" },
  settings = {
    nim = {
      useNimCheck = true,
    },
  },
})
