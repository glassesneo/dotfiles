--- lua_source {{{
-- local neofusion_palette = require("neofusion.palette")

require("bufferline").setup({
  options = {
    themable = true,
    indicator = {
      style = "icon",
      icon = " |> ",
    },
    buffer_close_icon = "",
    close_icon = "",
    diagnostics = "nvim_lsp",
    diagnostics_update_on_event = true,
    color_icons = true,
    separator_style = { "", "" },
    -- separator_style = "slope",
  },
  highlights = {
    fill = {
      fg = "NONE",
      bg = "NONE",
    },
    background = {
      fg = "NONE",
      bg = "NONE",
    },
    tab = {
      fg = "NONE",
      bg = "NONE",
    },
    close_button = {
      fg = "NONE",
      bg = "NONE",
    },
    close_button_visible = {
      fg = "NONE",
      bg = "NONE",
    },
    close_button_selected = {
      fg = "NONE",
      bg = "NONE",
    },
    buffer_visible = {
      fg = "NONE",
      bg = "NONE",
    },
    buffer_selected = {
      -- fg = "NONE",
      bg = "NONE",
      bold = true,
      italic = true,
    },
    offset_separator = {
      fg = "NONE",
      bg = "NONE",
    },
    -- separator = {
    --   fg = "NONE",
    --   bg = "NONE",
    -- },
    -- separator_visible = {
    --   fg = "NONE",
    --   bg = "NONE",
    -- },
    separator_selected = {
      fg = "NONE",
      bg = "NONE",
    },
    indicator_visible = {
      fg = "NONE",
      bg = "NONE",
    },
    indicator_selected = {
      fg = "#ffffff",
      bg = "NONE",
    },
  },
})

-- vim.g.transparent_groups = vim.list_extend(
--   vim.g.transparent_groups or {},
--   vim.tbl_map(function(v)
--     return v.hl_group
--   end, vim.tbl_values(require("bufferline.config").highlights))
-- )
--- }}}
