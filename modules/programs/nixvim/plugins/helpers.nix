{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.helpers";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    extraPlugins = with pkgs.vimPlugins; [
      vim-eunuch
      mkdir-nvim
      {
        plugin = numb-nvim;
        optional = true;
      }
    ];
    extraConfigLua = ''
      require('lz.n').load({{
        'numb.nvim',
        event = {"CmdlineEnter"},
        after = function()
          require('numb').setup()
        end,
      }})
    '';
  };
}
