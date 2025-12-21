--- lua_source {{{
vim.keymap.set({ "i", "c" }, "<C-j>", "<Plug>(skkeleton-enable)")

vim.fn["skkeleton#config"]({
  globalDictionaries = { "@skk-dict-path@" },
  eggLikeNewline = true,
  userDictionary = "~/.config/.skkeleton",
})

local skkeleton_hook_group = vim.api.nvim_create_augroup("skkeleton_hook", { clear = true })
vim.api.nvim_create_autocmd("User", {
  group = skkeleton_hook_group,
  pattern = "skkeleton-enable-pre",
  callback = function()
    vim.keymap.set({ "i", "c" }, "<C-l>", "<Plug>(skkeleton-disable)")
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
  border = "solid",
  fadeOutMs = 1200,
  eijiText = "en",
})
--- }}}
