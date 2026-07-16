{delib, ...}:
delib.module {
  name = "programs.nvf.autopairs";
  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim = {
    autopairs.nvim-autopairs = {
      enable = true;

      setupOpts = {
        check_ts = true;
      };
    };
  };
}
