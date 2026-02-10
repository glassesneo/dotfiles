{
  plugins =
    [
        {
          repo = "vim-skk/skkeleton",
          on_event = [ "InsertEnter", "CmdlineEnter" ],
          hooks_file = "$DPP_HOOK_DIR/skk.vim",
          hook_add =
            "  imap <C-j> <Plug>(skkeleton-enable)\n  cmap <C-j> <Plug>(skkeleton-enable)\n  imap <C-l> <Plug>(skkeleton-disable)\n  cmap <C-l> <Plug>(skkeleton-disable)\n"
        },
        {
          repo = "delphinus/skkeleton_indicator.nvim",
          on_source = "skkeleton",
          "if" = "has('nvim')",
          lua_source =
            "  require(\"skkeleton_indicator\").setup({\n    border = \"solid\",\n    fadeOutMs = 1200,\n    eijiText = \"en\",\n  })\n"
        }
      ]
}
