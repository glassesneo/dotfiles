{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.motion";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      spider = {
        enable = true;
        keymaps.motions = {
          b = "b";
          e = "e";
          ge = "ge";
          w = "w";
        };
        # lazyLoad = {
        # enable = true;
        # settings.keys = [
        # "b"
        # "e"
        # "ge"
        # "w"
        # ];
        # };
      };
    };
    extraPlugins = [
      pkgs.vimPlugins.clever-f-vim
      pkgs.vimPlugins.vim-asterisk
      pkgs.vimPlugins.kensaku
      pkgs.vimPlugins.kensaku-search
      pkgs.vimPlugins.fuzzy-motion
    ];
    extraConfigLua = builtins.readFile ./motion.lua;
  };
}
