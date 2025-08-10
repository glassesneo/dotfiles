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
      mkdir-nvim
      numb-nvim
      vim-eunuch
    ];
    extraConfigLua = ''
      require("numb").setup()
    '';
  };
}
