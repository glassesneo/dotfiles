{
  plugins =
    [
        {
          repo = "ysmb-wtsg/in-and-out.nvim",
          "if" = "has('nvim')",
          on_map = { i = "<C-CR>" },
          lua_add = "",
          lua_source =
            "  require(\"in-and-out\").setup({\n      additional_targets = { \"$\" }\n  })\n  vim.keymap.set(\"i\", \"<C-CR>\", function()\n    require(\"in-and-out\").in_and_out()\n  end)\n"
        }
      ]
}
