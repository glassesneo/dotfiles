local skkeleton_group = vim.api.nvim_create_augroup("dotfiles-skkeleton", { clear = true })

vim.api.nvim_create_autocmd("User", {
  group = skkeleton_group,
  pattern = "skkeleton-initialize-pre",
  callback = function()
    vim.fn["skkeleton#config"]({
      globalDictionaries = { "@skk-dict-path@" },
      eggLikeNewline = true,
      userDictionary = "@user-dict-path@",
      sources = { "skk_dictionary", "skk_server" },
      skkServerHost = "127.0.0.1",
      skkServerPort = 1178,
      skkServerResEnc = "euc-jp",
      skkServerReqEnc = "euc-jp",
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
  end,
})

vim.cmd([[
  imap <C-j> <Plug>(skkeleton-enable)
  cmap <C-j> <Plug>(skkeleton-enable)
  imap <C-l> <Plug>(skkeleton-disable)
  cmap <C-l> <Plug>(skkeleton-disable)
]])
