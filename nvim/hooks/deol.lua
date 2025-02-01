--- lua_source {{{
local height = (vim.go.lines - vim.go.lines % 3) / 3
local artemis = require("artemis")

-- vim.g["deol#floating_border"] = "rounded"
vim.keymap.set("n", "<Leader>d", function()
  local windows = vim.api.nvim_list_wins()
  for _, win in ipairs(windows) do
    local buf = vim.api.nvim_win_get_buf(win)
    local buf_filetype = vim.api.nvim_get_option_value("filetype", { buf = buf })
    if buf_filetype == "deol" then
      vim.api.nvim_set_current_win(win)
      return
    end
  end
  artemis.fn.deol.start({
    split = "horizontal",
    start_insert = false,
    toggle = false,
    winheight = height,
  })
  vim.cmd("wincmd J")
  vim.api.nvim_win_set_height(0, height)
end)

vim.api.nvim_create_autocmd("FileType", {
  pattern = "deol",
  callback = function()
    vim.keymap.set("n", "q", "<Plug>(deol_quit)")
  end,
})
--- }}}
