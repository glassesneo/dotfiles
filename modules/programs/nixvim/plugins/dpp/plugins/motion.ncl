{
  plugins =
    [
        { repo = "lambdalisue/kensaku.vim" },
        {
          repo = "lambdalisue/kensaku-search.vim",
          depends = [ "kensaku.vim" ],
          on_map = { c = "<Plug>(kensaku-search-replace)" },
          lua_add =
            "  vim.keymap.set(\"c\", \"<CR>\", function()\n    return vim.fn.getcmdtype()  == \"/\" and \"<Plug>(kensaku-search-replace)<CR>\" or \"<CR>\"\n  end, { expr = true })\n"
        },
        {
          repo = "yuki-yano/fuzzy-motion.vim",
          depends = [ "kensaku.vim" ],
          on_cmd = "FuzzyMotion",
          lua_add =
            "  vim.keymap.set(\"n\", \"<S-s>\", function()\n    vim.cmd[\"FuzzyMotion\"]()\n  end, { noremap = true })\n",
          lua_source =
            "  vim.g[\"fuzzy_motion_matchers\"] = { \"kensaku\", \"fzf\" }\n"
        },
        {
          repo = "skanehira/jumpcursor.vim",
          on_map = "<Plug>(jumpcursor-jump)",
          lua_add =
            "  vim.keymap.set(\"n\", \"<CR>j\", \"<Plug>(jumpcursor-jump)\")\n"
        }
      ]
}
