{
  plugins =
    [
        {
          repo = "vim-skk/skkeleton",
          on_event = [ "InsertEnter", "CmdlineEnter" ],
          hooks_file = "$DPP_HOOK_DIR/skk.lua"
        },
        { repo = "delphinus/skkeleton_indicator.nvim", on_source = "skkeleton" }
      ]
}