{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.editing";
  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim = {
    utility = {
      mkdir.enable = true;
      surround = {
        enable = true;
        useVendoredKeybindings = false;
      };
    };

    lazy.plugins."numb.nvim" = {
      package = pkgs.vimPlugins.numb-nvim;
      event = ["CmdlineEnter"];
      after = ''
        require("numb").setup()
      '';
    };
  };
}
