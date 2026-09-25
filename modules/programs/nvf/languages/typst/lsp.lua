local lsp = require("nvf.lsp")

local function project_root(path)
  return lsp.nearest_marker(path, { "flake.nix", ".git" }) or lsp.file_root(path)
end

lsp.setup("tinymist", "tinymist", project_root, {
  cmd = { "tinymist" },
  filetypes = { "typst" },
  settings = { formatterMode = "typstyle" },
})
