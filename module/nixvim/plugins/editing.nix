{pkgs, ...}: let
  in-and-out = pkgs.vimUtils.buildVimPlugin {
    name = "in-and-out.nvim";
    src = pkgs.fetchFromGitHub {
      owner = "ysmb-wtsg";
      repo = "in-and-out.nvim";
      rev = "ca02f04c0817e7712f0c9bde5016c36b80339413";
      hash = "sha256-ggaq3NOenNkzp4A8gNXjyRbbbLLQXmEXPhWU5lCWSqo=";
    };
  };
in {
  plugins = {
    bullets = {
      enable = true;
    };
    ccc = {
      enable = true;
      lazyLoad.settings = {
        cmd = [
          "CccPick"
          "CccConvert"
        ];
      };
    };
    lexima = {
      enable = true;
    };
    vim-surround = {
      enable = true;
    };
    ts-context-commentstring = {
      enable = true;
      extraOptions = {
        enable_autocmd = false;
      };
      languages = {
        elm = "-- %s";
        nim = "# %s";
        nu = "# %s";
        toml = "# %s";
        typst = "// %s";
        v = "// %s";
        zig = "// %s";
      };
    };
    ts-autotag = {
      enable = true;
      settings = {
        opts = {
          enable_close = true;
          enable_close_on_slash = false;
          enable_rename = true;
        };
      };
    };
  };
  extraPlugins = [
    in-and-out
  ];
  extraConfigLua = ''
    -- lexima.vim
    -- Nim
    vim.fn["lexima#add_rule"]({
      char = ".",
      at = [[{\%#}]],
      input_after = ".",
      filetype = { "nim", "nims", "nimble" },
    })
    vim.fn["lexima#add_rule"]({
      char = ".",
      at = [[{\%#.}]],
      leave = 1,
      filetype = { "nim", "nims", "nimble" },
    })
    vim.fn["lexima#add_rule"]({
      char = "<BS>",
      at = [[{.\%#.}]],
      delete = 1,
      filetype = { "nim", "nims", "nimble" },
    })
    -- Typst
    vim.fn["lexima#add_rule"]({
      char = '$',
      input_after = '$',
      filetype = { 'typst' },
    })
    vim.fn["lexima#add_rule"]({
      char = '$',
      at = '\%#\$',
      leave = 1,
      filetype = { "typst" },
    })
    vim.fn["lexima#add_rule"]({
      char = '<BS>',
      at = '\$\%#\$',
      delete = 1,
      filetype = { "typst" },
    })

    require("in-and-out").setup({
      additional_targets = { "$" }
    })
    vim.keymap.set("i", "<C-CR>", function()
      require("in-and-out").in_and_out()
    end)

    local get_option = vim.filetype.get_option
    vim.filetype.get_option = function(filetype, option)
      return option == "commentstring"
        and require("ts_context_commentstring.internal").calculate_commentstring()
        or get_option(filetype, option)
    end
  '';
}
