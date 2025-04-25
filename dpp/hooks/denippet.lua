--- lua_add {{{
vim.keymap.set({ "i", "s" }, "<C-l>", "<Plug>(denippet-jump-next)")
vim.keymap.set({ "i", "s" }, "<C-h>", "<Plug>(denippet-jump-prev)")
-- vim.keymap.set({ "i", "s" }, "<C-l>", function()
-- if vim.fn["denippet#jumpable"](1) then
-- return "<Plug>(denippet-jump-next)"
-- else
-- return "<C-l>"
-- end
-- end, { remap = true, expr = true })
-- vim.keymap.set({ "i", "s" }, "<C-l>", function()
-- if vim.fn["denippet#jumpable"](-1) then
-- return "<Plug>(denippet-jump-prev)"
-- else
-- return "<C-h>"
-- end
-- end, { remap = true, expr = true })
--- }}}

--- lua_post_source {{{
local friendly_snippets_path =
  vim.fn.globpath(vim.fs.joinpath(vim.fn["dpp#get"]("friendly-snippets").path, "snippets"), "**/*.json", true, true)
for _, snip in ipairs(friendly_snippets_path) do
  vim.fn["denippet#load"](snip)
end
--- }}}
