-- Strip Neovim's global LSP defaults. K (hover) stays; :help lsp-defaults-disable.
-- Only delete a map when it still looks like an LSP default so user maps such
-- as insert <C-s> for :update are left alone regardless of load order.
local M = {}

local global_maps = {
  { mode = { "n", "v" }, lhs = "gra" }, { mode = "n", lhs = "gri" }, { mode = "n", lhs = "grn" },
  { mode = "n", lhs = "grr" }, { mode = "n", lhs = "grt" }, { mode = "n", lhs = "grx" }, { mode = "n", lhs = "gO" },
  { mode = { "i", "s" }, lhs = "<C-s>" },
}

local function looks_like_lsp_default(map)
  if type(map) ~= "table" or next(map) == nil then
    return false
  end
  local desc = map.desc or ""
  local rhs = map.rhs or ""
  return desc:find("[Ll]sp") ~= nil or rhs:find("vim%.lsp") ~= nil or rhs:find("vim%.diagnostic") ~= nil
end

local function del_lsp_default(mode, lhs)
  local modes = type(mode) == "table" and mode or { mode }
  for _, item in ipairs(modes) do
    if looks_like_lsp_default(vim.fn.maparg(lhs, item, false, true)) then
      pcall(vim.keymap.del, item, lhs)
    end
  end
end

function M.setup()
  local function strip()
    for _, spec in ipairs(global_maps) do
      del_lsp_default(spec.mode, spec.lhs)
    end
  end

  strip()
  vim.api.nvim_create_autocmd("VimEnter", {
    once = true,
    callback = strip,
  })
end

return M
