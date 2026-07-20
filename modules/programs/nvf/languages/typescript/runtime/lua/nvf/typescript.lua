local lsp = require("nvf.lsp")
local M = {}

-- Deno has priority over Biome at every ancestor. Ordinary TypeScript is the
-- fallback only when neither marker exists, so primary web clients never
-- overlap. The formatter configuration consumes the same routing function.
function M.route(path)
  if not path or path == "" then
    return nil, nil
  end
  local deno_root = lsp.nearest_marker(path, { "deno.json", "deno.jsonc" })
  if deno_root then
    return "deno", deno_root
  end
  local biome_root = lsp.nearest_marker(path, { "biome.json", "biome.jsonc" })
  if biome_root then
    return "biome", biome_root
  end
  return "typescript",
    lsp.nearest_marker(path, { "tsconfig.json", "jsconfig.json", "package.json" }) or lsp.file_root(path)
end

function M.root(route)
  return function (path)
    local selected, root = M.route(path)
    if selected == route then
      return root
    end
  end
end

function M.formatters(bufnr)
  local path = lsp.buffer_path(bufnr)
  if not path then
    return {}
  end
  local route = M.route(path)
  return route == "biome" and { "biome" } or {}
end

return M
