{
  delib,
  inputs,
  pkgs,
  ...
}: let
  amp-nvim = pkgs.vimUtils.buildVimPlugin {
    name = "amp.nvim";
    src = inputs.amp-nvim;
  };
in
  delib.module {
    name = "programs.amp";

    options = delib.singleEnableOption true;

    home.ifEnabled = {
      home.packages = [
        pkgs.amp-cli
      ];
      programs.nixvim = {
        extraPlugins = [
          amp-nvim
        ];
        extraConfigLua = ''
          require("amp").setup({})
        '';
      };
    };
  }

