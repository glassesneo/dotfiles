--- lua_source {{{
vim.keymap.set({ "i" }, "<C-j>", "<Plug>(skkeleton-enable)")

vim.fn["skkeleton#config"]({
  globalDictionaries = { "~/.config/skk/SKK-JISYO.L" },
  eggLikeNewline = true,
  userDictionary = "~/.config/.skkeleton",
})

local skkeleton_hook_group = vim.api.nvim_create_augroup("skkeleton_hook", { clear = true })
vim.api.nvim_create_autocmd("User", {
  group = skkeleton_hook_group,
  pattern = "skkeleton-enable-pre",
  callback = function()
    vim.keymap.set({ "i" }, "<C-l>", "<Plug>(skkeleton-disable)")
  end,
})

vim.api.nvim_create_autocmd("User", {
  group = skkeleton_hook_group,
  pattern = "skkeleton-disable-pre",
  callback = function()
    vim.keymap.set({ "i", "s" }, "<C-l>", "<Plug>(denippet-jump-next)")
  end,
})

vim.fn["skkeleton#register_keymap"]("input", ":", "henkanPoint")
vim.fn["skkeleton#register_kanatable"]("rom", {
  l = false,
  la = { "ぁ" },
  li = { "ぃ" },
  lu = { "ぅ" },
  le = { "ぇ" },
  lo = { "ぉ" },
  lya = { "ゃ" },
  lyu = { "ゅ" },
  lyo = { "ょ" },
})

require("skkeleton_indicator").setup({
  border = "single",
  fadeOutMs = 1200,
  eijiText = "en",
})
--- }}}
