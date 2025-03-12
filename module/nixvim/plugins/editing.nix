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
        nim = "# %s";
        nu = "# %s";
        toml = "# %s";
        v = "// %s";
      };
    };
  };
  extraPlugins = [
    in-and-out
  ];
  extraConfigLua = ''
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
