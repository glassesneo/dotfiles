local lsp = require("nvf.lsp")

local function python_root(path)
  return lsp.nearest_marker(path, {
    "ty.toml",
    "pyproject.toml",
    "ruff.toml",
    ".ruff.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    ".git",
  }) or lsp.file_root(path)
end

lsp.setup("ty", "ty", python_root, {
  cmd = { "ty", "server" },
  filetypes = { "python" },
})

lsp.setup("ruff", "ruff", python_root, {
  cmd = { "ruff", "server" },
  filetypes = { "python" },
})
