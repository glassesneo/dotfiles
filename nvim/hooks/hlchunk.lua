--- lua_source {{{
-- local neofusion_palette = require("neofusion.palette")

require("hlchunk").setup({
  indent = {
    enable = false,
    use_treesitter = true,
    chars = { "│", "¦" },
    style = {
      "#0d428c",
    },
  },
  -- blank = {
  --   enable = true,
  -- },
  chunk = {
    enable = false,
    use_treesitter = true,
    chars = {
      horizontal_line = "─",
      vertical_line = "│",
      left_top = "┌",
      left_bottom = "└",
      right_arrow = ">",
    },

    style = "#ffc561",
  },
  line_num = {
    enable = true,
    use_treesitter = true,
    -- style = neofusion_palette.faded_purple,
  },
})
--- }}}
