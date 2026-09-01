local lsp = require("nvf.lsp")

local function ocaml_root(path)
  local dune_root = lsp.nearest_marker(path, { "dune-project", "dune-workspace" })
  if dune_root then
    return dune_root
  end

  local dir = vim.fs.dirname(path)
  local opam = vim.fs.find(function(name)
    return name:match("%.opam$") ~= nil
  end, { path = dir, upward = true, type = "file", limit = 1 })[1]
  if opam then
    return vim.fs.dirname(opam)
  end

  return lsp.nearest_marker(path, { "esy.json", "package.json", ".git" }) or lsp.file_root(path)
end

local language_id_of = {
  menhir = "ocaml.menhir",
  ocaml = "ocaml",
  ocamlinterface = "ocaml.interface",
  ocamllex = "ocaml.ocamllex",
  reason = "reason",
  dune = "dune",
}

lsp.setup("ocamllsp", "ocamllsp", ocaml_root, {
  cmd = { "ocamllsp" },
  filetypes = { "ocaml", "menhir", "ocamlinterface", "ocamllex", "reason", "dune" },
  get_language_id = function(_, ftype)
    return language_id_of[ftype]
  end,
})
