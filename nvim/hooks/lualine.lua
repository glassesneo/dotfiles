--- lua_source {{{
---@nodiscard
local diff_source = function()
  local gitsigns = vim.b.gitsigns_status_dict
  if gitsigns then
    return {
      added = gitsigns.added,
      modified = gitsigns.changed,
      removed = gitsigns.removed,
    }
  end
end

---@return string
local total_lines = function()
  return vim.fn.line("$") .. " lines"
end

-- local neofusion_lualine = require("neofusion.lualine")
-- local palette = require("neofusion.palette")

require("lualine").setup({
  options = {
    -- section_separators = { left = "", right = "" },
    component_separators = { left = "", right = "" },
    section_separators = {},
    -- component_separators = {},
    globalstatus = true,
    theme = "retrowave",
    disabled_filetypes = {
      "ddu-filer",
      "ddu-ff",
      "deol",
    },
  },
  sections = {
    lualine_a = {
      {
        "mode",
      },
      {
        "b:gitsigns_head",
        icon = {
          "",
          color = {
            fg = "#ffba4f",
            bg = "NONE",
          },
        },
        color = {
          -- fg = palette.bright_aqua,
          bg = "NONE",
        },
      },
    },
    lualine_b = {
      { "lsp-status", color = { bg = "NONE" } },
      {
        "filename",
        newfile_status = true,
        path = 4,
        shorting_target = 30,
        symbols = {
          modified = "_",
          readonly = " ",
          newfile = "󰘩 ",
        },
        color = {
          bg = "NONE",
        },
      },
    },
    lualine_c = {},
    lualine_x = {
      {
        "encoding",
        color = {
          bg = "NONE",
        },
      },
    },
    lualine_y = {
      {
        "searchcount",
        draw_empty = true,
        color = {
          bg = "NONE",
        },
      },
    },
    lualine_z = {
      {
        "filetype",
        color = {
          bg = "NONE",
        },
      },
      {
        "datetime",
        style = "%m/%d(%A) %H:%M",
        color = {
          -- fg = palette.bright_aqua,
          bg = "NONE",
        },
      },
    },
  },
  winbar = {
    lualine_a = {
      {
        "diagnostics",
        sources = { "nvim_diagnostic", "nvim_lsp" },
        sections = { "error", "warn", "info", "hint" },
        symbols = {
          error = " ",
          warn = " ",
          info = " ",
          hint = " ",
        },
        draw_empty = true,
        color = {
          -- fg = palette.bright_aqua,
          bg = "NONE",
        },
      },
    },
    lualine_b = {},
    lualine_c = {
      {
        "navic",
        color = {
          bg = "NONE",
        },
      },
    },
    lualine_x = {
      {
        "diff",
        symbols = {
          added = " ",
          modified = " ",
          removed = " ",
        },
        source = diff_source,
        color = {
          bg = "NONE",
        },
      },
    },
    lualine_y = {},
    lualine_z = {
      {
        total_lines,
        color = {
          -- fg = palette.dark4
          bg = "#fad600",
        },
      },
    },
  },
  inactive_winbar = {
    lualine_a = {
      {
        "diagnostics",
        sources = { "nvim_diagnostic", "nvim_lsp" },
        sections = { "error", "warn", "info", "hint" },
        symbols = {
          error = " ",
          warn = " ",
          info = " ",
          hint = " ",
        },
        separator = { left = "", right = "" },
        draw_empty = true,
        color = {
          -- fg = palette.bright_aqua,
          bg = "NONE",
        },
      },
    },
    lualine_b = {},
    lualine_c = {},
    lualine_x = {
      {
        "diff",
        symbols = {
          added = " ",
          modified = " ",
          removed = " ",
        },
        source = diff_source,
      },
    },
    lualine_y = {},
    lualine_z = {
      {
        total_lines,
        -- color = { fg = palette.dark4 },
      },
    },
  },
})

vim.cmd("highlight lualine_c_normal guibg=NONE")
vim.cmd("highlight lualine_c_inactive guibg=NONE")
vim.o.showmode = false

-- require("transparent").clear_prefix("lualine")
--- }}}
