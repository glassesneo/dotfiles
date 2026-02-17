{
  plugins =
    [
        {
          repo = "Shougo/ddc.vim",
          "if" = "!has('nvim')",
          on_event = [ "InsertEnter", "CmdlineEnter" ],
          hooks_file = "$DPP_HOOK_DIR/ddc.vim",
        },
        {
          repo = "Shougo/pum.vim",
          "if" = "!has('nvim')",
          on_source = "ddc.vim",
        },
        {
          repo = "Shougo/ddc-ui-pum",
          "if" = "!has('nvim')",
          on_source = "ddc.vim",
        },
        {
          repo = "Shougo/ddc-source-around",
          "if" = "!has('nvim')",
          on_source = "ddc.vim",
        },
        {
          repo = "LumaKernel/ddc-source-file",
          "if" = "!has('nvim')",
          on_source = "ddc.vim",
        },
        {
          repo = "Shougo/ddc-source-vim",
          "if" = "!has('nvim')",
          on_source = "ddc.vim",
        },
        {
          repo = "prabirshrestha/vim-lsp",
          "if" = "!has('nvim')",
          on_source = "ddc.vim",
          hooks_file = "$DPP_HOOK_DIR/vim-lsp.vim",
        },
        {
          repo = "shun/ddc-source-vim-lsp",
          "if" = "!has('nvim')",
          on_source = "ddc.vim",
        },
        {
          repo = "tani/ddc-fuzzy",
          "if" = "!has('nvim')",
          on_source = "ddc.vim",
        },
        {
          repo = "Shougo/ddc-converter_remove_overlap",
          "if" = "!has('nvim')",
          on_source = "ddc.vim",
        },
        {
          repo = "Shougo/ddc-filter-matcher_head",
          "if" = "!has('nvim')",
          on_source = "ddc.vim",
        },
        {
          repo = "Shougo/ddc-filter-sorter_rank",
          "if" = "!has('nvim')",
          on_source = "ddc.vim",
        },
      ]
}
