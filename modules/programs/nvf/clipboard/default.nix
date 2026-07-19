{delib, ...}:
delib.module {
  name = "programs.nvf.clipboard";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf.settings.vim = {
      clipboard = {
        enable = true;
        registers = "unnamedplus";
      };
    };
  };
}
