--- lua_add {{{
local artemis = require("artemis")
-- completion keymaps
local pum_forward_insert = function()
  artemis.fn.pum.map.insert_relative(1, "loop")
end
local pum_backward_insert = function()
  artemis.fn.pum.map.insert_relative(-1, "loop")
end
local pum_forward_select = function()
  artemis.fn.pum.map.select_relative(1, "loop")
end
local pum_backward_select = function()
  artemis.fn.pum.map.select_relative(-1, "loop")
end
local pum_confirm = function()
  artemis.fn.pum.map.confirm()
end

vim.keymap.set({ "i" }, "<C-n>", pum_forward_select)
vim.keymap.set({ "i" }, "<C-p>", pum_backward_select)

vim.keymap.set({ "t" }, "<C-n>", pum_forward_select)
vim.keymap.set({ "t" }, "<C-p>", pum_backward_select)

vim.keymap.set({ "i", "t" }, "<C-y>", pum_confirm)
vim.api.nvim_create_user_command("CommandlinePre", function()
  vim.keymap.set("c", "<C-n>", pum_forward_insert)
  vim.keymap.set("c", "<C-p>", pum_backward_insert)
  vim.keymap.set("c", "<C-y>", pum_confirm)

  vim.api.nvim_create_autocmd({ "User" }, {
    pattern = "DDCCmdlineLeave",
    once = true,
    callback = function()
      vim.keymap.del("c", "<C-n>", { silent = true })
      vim.keymap.del("c", "<C-p>", { silent = true })
      vim.keymap.del("c", "<C-y>", { silent = true })
    end,
  })
  artemis.fn.ddc.enable_cmdline_completion()
end, {})

vim.keymap.set("n", ":", "<Cmd>CommandlinePre<CR>:")

-- vim.keymap.set("n", "/", "<Cmd>CommandlinePre<CR>/")
--- }}}

--- lua_source {{{
local artemis = require("artemis")

artemis.fn.ddc.custom.load_config(vim.env.HOOK_DIR .. "/ddc.ts")

artemis.fn.ddc.enable_terminal_completion()
artemis.fn.ddc.enable()

-- pum.vim config
artemis.fn.pum.set_option({
  -- blend = 30,
  border = "single",
  item_orders = { "abbr", "space", "kind", "space", "menu" },
  offset_cmdrow = 2,
  scrollbar_char = "┃",
  use_setline = true,
  max_columns = {
    kind = 10,
    menu = 30,
  },
  -- insert_preview = true,
  preview = false,
  -- preview_border = "rounded",
  -- preview_delay = 100,
  -- preview_width = 30,
  -- preview_height = 30,
})

artemis.fn.pum.set_local_option("c", {
  -- follow_cursor = true,
  max_height = vim.go.lines - 30,
  -- preview = false,
})

--- }}}
