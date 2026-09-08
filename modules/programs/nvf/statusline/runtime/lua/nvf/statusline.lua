local conditions = require("heirline.conditions")
local utils = require("heirline.utils")

local M = {}

local function highlight_attr(name, attr)
  local hl = utils.get_highlight(name)
  if hl and hl[attr] then
    return hl[attr]
  end
end

-- Transparent themes leave StatusLine/Normal backgrounds unset; heirline
-- rejects nil aliases such as "bg", so missing values become NONE.
local function color_or_none(...)
  for i = 1, select("#", ...) do
    local value = select(i, ...)
    if value then
      return value
    end
  end
  return "NONE"
end

local function setup_colors()
  return {
    fg = color_or_none(highlight_attr("StatusLine", "fg"), highlight_attr("Normal", "fg")),
    bg = color_or_none(highlight_attr("StatusLine", "bg"), highlight_attr("Normal", "bg")),
    red = color_or_none(highlight_attr("DiagnosticError", "fg")),
    green = color_or_none(highlight_attr("String", "fg")),
    blue = color_or_none(highlight_attr("Function", "fg")),
    orange = color_or_none(highlight_attr("Constant", "fg")),
    purple = color_or_none(highlight_attr("Statement", "fg")),
    cyan = color_or_none(highlight_attr("Special", "fg")),
    diag_error = color_or_none(highlight_attr("DiagnosticError", "fg")),
    diag_warn = color_or_none(highlight_attr("DiagnosticWarn", "fg")),
    diag_info = color_or_none(highlight_attr("DiagnosticInfo", "fg")),
    diag_hint = color_or_none(highlight_attr("DiagnosticHint", "fg")),
    git_add = color_or_none(highlight_attr("GitSignsAdd", "fg"), highlight_attr("diffAdded", "fg")),
    git_change = color_or_none(highlight_attr("GitSignsChange", "fg"), highlight_attr("diffChanged", "fg")),
    git_del = color_or_none(highlight_attr("GitSignsDelete", "fg"), highlight_attr("diffDeleted", "fg")),
    directory = color_or_none(highlight_attr("Directory", "fg")),
    type_fg = color_or_none(highlight_attr("Type", "fg")),
    comment = color_or_none(highlight_attr("Comment", "fg")),
  }
end

local mode_colors = {
  n = "blue",
  i = "green",
  v = "cyan",
  V = "cyan",
  ["\22"] = "cyan",
  c = "orange",
  s = "purple",
  S = "purple",
  ["\19"] = "purple",
  R = "orange",
  r = "orange",
  ["!"] = "red",
  t = "red",
}

local function current_mode_color(self)
  local mode = (self.mode or "n"):sub(1, 1)
  return mode_colors[mode] or "blue"
end

local mode_update = {
  "ModeChanged",
  pattern = "*:*",
  callback = vim.schedule_wrap(function ()
    vim.cmd.redrawstatus()
  end),
}

-- Outer / close the line with a one-sided round; inner / stay point-symmetric.
local function mode_hl(self)
  return { fg = current_mode_color(self), bg = "bg" }
end

local function ModeEnd(first, second)
  return {
    init = function (self)
      self.mode = vim.fn.mode(1)
    end,
    update = mode_update,
    provider = first .. "█" .. second,
    hl = mode_hl,
  }
end

local Align = { provider = "%=" }
local Space = { provider = " " }
-- Same / angle as  /  (powerline extra thin forwardslash).
local Slash = { provider = "  ", hl = { fg = "comment" } }

-- Insert slashes between currently visible items. Use on the left/right
-- clusters only; the center group stays unseparated.
local function slashed(items)
  local children = {}
  for i, item in ipairs(items) do
    if i > 1 then
      table.insert(children, {
        condition = function ()
          if item.condition and not item.condition(item) then
            return false
          end
          for j = 1, i - 1 do
            local prev = items[j]
            if not prev.condition or prev.condition(prev) then
              return true
            end
          end
          return false
        end,
        Slash,
      })
    end
    table.insert(children, item)
  end
  return children
end

-- Keep the first directory and the last two path parts, like LazyVim pretty_path.
local function pretty_path(path)
  local parts = vim.split(path, "[\\/]", { trimempty = true })
  if #parts <= 3 then
    return path
  end
  return table.concat({ parts[1], "…", parts[#parts - 1], parts[#parts] }, "/")
end

local FileNameBlock = {
  init = function (self)
    self.filename = vim.api.nvim_buf_get_name(0)
  end,
  {
    provider = function (self)
      local filename = vim.fn.fnamemodify(self.filename, ":.")
      if filename == "" then
        return "[No Name]"
      end
      if not conditions.width_percent_below(#filename, 0.25) then
        filename = pretty_path(filename)
      end
      return filename
    end,
    hl = { fg = "directory" },
  },
  {
    condition = function ()
      return vim.bo.modified
    end,
    provider = "_",
    hl = { fg = "green" },
  },
  {
    condition = function ()
      return not vim.bo.modifiable or vim.bo.readonly
    end,
    provider = " ",
    hl = { fg = "orange" },
  },
  {
    condition = function (self)
      return self.filename ~= "" and vim.bo.buftype == "" and vim.fn.filereadable(self.filename) == 0
    end,
    provider = "🆕 ",
    hl = { fg = "green" },
  },
  { provider = "%<" },
}

local GitDiff = {
  condition = conditions.is_git_repo,
  init = function (self)
    self.status_dict = vim.b.gitsigns_status_dict or {}
  end,
  {
    provider = function (self)
      local count = self.status_dict.added or 0
      return count > 0 and (" " .. count .. " ")
    end,
    hl = { fg = "git_add" },
  },
  {
    provider = function (self)
      local count = self.status_dict.changed or 0
      return count > 0 and (" " .. count .. " ")
    end,
    hl = { fg = "git_change" },
  },
  {
    provider = function (self)
      local count = self.status_dict.removed or 0
      return count > 0 and (" " .. count)
    end,
    hl = { fg = "git_del" },
  },
}

local Diagnostics = {
  condition = conditions.has_diagnostics,
  static = {
    error_icon = " ",
    warn_icon = " ",
    info_icon = " ",
    hint_icon = " ",
  },
  init = function (self)
    local counts = vim.diagnostic.count(0)
    self.errors = counts[vim.diagnostic.severity.ERROR] or 0
    self.warnings = counts[vim.diagnostic.severity.WARN] or 0
    self.info = counts[vim.diagnostic.severity.INFO] or 0
    self.hints = counts[vim.diagnostic.severity.HINT] or 0
  end,
  update = {
    "DiagnosticChanged",
    "BufEnter",
    callback = vim.schedule_wrap(function ()
      vim.cmd.redrawstatus()
    end),
  },
  {
    provider = function (self)
      return self.errors > 0 and (self.error_icon .. self.errors .. " ")
    end,
    hl = { fg = "diag_error" },
  },
  {
    provider = function (self)
      return self.warnings > 0 and (self.warn_icon .. self.warnings .. " ")
    end,
    hl = { fg = "diag_warn" },
  },
  {
    provider = function (self)
      return self.info > 0 and (self.info_icon .. self.info .. " ")
    end,
    hl = { fg = "diag_info" },
  },
  {
    provider = function (self)
      return self.hints > 0 and (self.hint_icon .. self.hints)
    end,
    hl = { fg = "diag_hint" },
  },
}

local function current_search()
  if vim.v.hlsearch == 0 then
    return nil
  end
  local ok, search = pcall(vim.fn.searchcount)
  if not ok or not search or not search.total or search.total == 0 then
    return nil
  end
  return search
end

local SearchCount = {
  condition = function ()
    return current_search() ~= nil
  end,
  provider = function ()
    local search = current_search()
    if not search then
      return ""
    end
    return string.format("[%d/%d]", search.current, math.min(search.total, search.maxcount))
  end,
  hl = { fg = "orange" },
}

local LSPCount = {
  condition = conditions.lsp_attached,
  update = {
    "LspAttach",
    "LspDetach",
    "BufEnter",
    callback = vim.schedule_wrap(function ()
      vim.cmd.redrawstatus()
    end),
  },
  provider = function ()
    local count = #vim.lsp.get_clients({ bufnr = 0 })
    return count > 0 and ("󰅩 " .. count)
  end,
  hl = { fg = "green", bold = true },
}

local FileType = {
  condition = function ()
    return vim.bo.filetype ~= ""
  end,
  init = function (self)
    self.ft = vim.bo.filetype
    local ok, devicons = pcall(require, "nvim-web-devicons")
    if ok then
      self.icon, self.icon_color = devicons.get_icon_color(self.ft, nil, { default = true })
    end
  end,
  {
    provider = function (self)
      return self.icon and (self.icon .. " ") or ""
    end,
    hl = function (self)
      if self.icon_color then
        return { fg = self.icon_color }
      end
    end,
  },
  {
    provider = function (self)
      return self.ft
    end,
    hl = { fg = "type_fg", bold = true },
  },
}

local StatusLine = {
  hl = { fg = "fg", bg = "bg" },
  ModeEnd("", ""),
  Space,
  slashed({
    FileNameBlock,
  }),
  Align,
  GitDiff,
  {
    condition = function ()
      return conditions.is_git_repo() and conditions.has_diagnostics()
    end,
    Space,
  },
  Diagnostics,
  Align,
  slashed({
    SearchCount,
    LSPCount,
    FileType,
  }),
  Space,
  ModeEnd("", ""),
}

function M.setup()
  vim.o.laststatus = 3
  vim.o.showmode = false

  require("heirline").load_colors(setup_colors())
  require("heirline").setup({
    statusline = StatusLine,
  })

  local group = vim.api.nvim_create_augroup("NvfHeirline", { clear = true })
  vim.api.nvim_create_autocmd("ColorScheme", {
    group = group,
    callback = function ()
      utils.on_colorscheme(setup_colors)
    end,
  })
  vim.api.nvim_create_autocmd("User", {
    group = group,
    pattern = "GitSignsUpdate",
    callback = vim.schedule_wrap(function ()
      vim.cmd.redrawstatus()
    end),
  })
end

return M
