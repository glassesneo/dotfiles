--- lua_add {{{
vim.keymap.set("n", ":", "<Cmd>CommandlinePre<CR>:")

-- vim.keymap.set("n", "/", "<Cmd>CommandlinePre<CR>/")
--- }}}

--- lua_source {{{
local utils = require("utils")
local artemis = require("artemis")

artemis.fn.ddc.custom.load_config(vim.env.HOOK_DIR .. "/ddc.ts")

-- snippet keymaps
-- vim.keymap.set({ "i", "s" }, "<C-l>", function()
--   if artemis.fn.denippet.jumpable(1) then
--     return "<Plug>(denippet-jump-next)"
--   else
--     return "<C-l>"
--   end
-- end)
--
-- vim.keymap.set({ "i", "s" }, "<C-h>", function()
--   if artemis.fn.denippet.jumpable(-1) then
--     return "<Plug>(denippet-jump-prev)"
--   else
--     return "<C-h>"
--   end
-- end)

vim.keymap.set({ "i", "s" }, "<C-l>", "<Plug>(denippet-jump-next)")
vim.keymap.set({ "i", "s" }, "<C-h>", "<Plug>(denippet-jump-prev)")

artemis.fn.ddc.enable_terminal_completion()
artemis.fn.ddc.enable()

-- pum.vim config
artemis.fn.pum.set_option({
  blend = 30,
  border = "rounded",
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
  -- max_height = vim.go.lines - 20,
  -- preview = false,
})

-- completion keymaps
local pum_forward = function()
  artemis.fn.pum.map.insert_relative(1, "loop")
end
local pum_backward = function()
  artemis.fn.pum.map.insert_relative(-1, "loop")
end
local pum_forward_term = function()
  artemis.fn.pum.map.select_relative(1, "loop")
end
local pum_backward_term = function()
  artemis.fn.pum.map.select_relative(-1, "loop")
end
local pum_confirm = function()
  artemis.fn.pum.map.confirm()
end

vim.keymap.set({ "i" }, "<C-n>", pum_forward)
vim.keymap.set({ "i" }, "<C-p>", pum_backward)

vim.keymap.set({ "t" }, "<C-n>", pum_forward_term)
vim.keymap.set({ "t" }, "<C-p>", pum_backward_term)

vim.keymap.set({ "i", "t" }, "<C-y>", pum_confirm)

vim.api.nvim_create_user_command("CommandlinePre", function()
  vim.keymap.set("c", "<C-n>", pum_forward)
  vim.keymap.set("c", "<C-p>", pum_backward)
  vim.keymap.set("c", "<C-y>", pum_confirm)

  vim.api.nvim_create_autocmd({ "User" }, {
    pattern = "DDCCmdlineLeave",
    once = true,
    callback = function()
      utils.unmap("c", "<C-n>", { silent = true })
      utils.unmap("c", "<C-p>", { silent = true })
      utils.unmap("c", "<C-y>", { silent = true })
    end,
  })
  artemis.fn.ddc.enable_cmdline_completion()
end, {})
--- }}}
