{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.statusline";
  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim = {
    additionalRuntimePaths = [./runtime];

    extraPlugins.heirline = {
      package = pkgs.vimPlugins.heirline-nvim;
      setup = "require('nvf.statusline').setup()";
    };
  };
}
