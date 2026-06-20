{delib, ...}:
delib.module {
  name = "programs.nvf.treesitter";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf.settings.vim = {
      treesitter = {
        enable = true;
        highlight.enable = true;
        indent.enable = true;
        fold = false;
      };
    };
  };
}
