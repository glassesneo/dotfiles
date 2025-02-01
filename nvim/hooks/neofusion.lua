--- lua_source {{{
-- Default options:
local neofusion_palette = require("neofusion.palette")
require("neofusion").setup({
  terminal_colors = true, -- add neovim terminal colors
  undercurl = true,
  underline = true,
  bold = true,
  italic = {
    strings = true,
    emphasis = true,
    comments = true,
    operators = false,
    folds = true,
  },
  strikethrough = true,
  invert_selection = false,
  invert_signs = false,
  invert_tabline = false,
  invert_intend_guides = false,
  inverse = true, -- invert background for search, diffs, statuslines and errors
  palette_overrides = {
    -- faded_red = "#ffc70e",
  },
  overrides = {
    -- ["@lsp.type.variable"] = { fg = "#ffc70e" },
    CursorLine = { bg = neofusion_palette.dark_aqua },
    CursorColumn = { bg = neofusion_palette.dark_aqua },
  },
  dim_inactive = false,
  transparent_mode = true,
})

vim.cmd([[ colorscheme neofusion ]])
--- }}}
