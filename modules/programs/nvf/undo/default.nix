{
  delib,
  homeConfig,
  ...
}:
delib.module {
  name = "programs.nvf.undo";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf.settings.vim = {
      undoFile = {
        enable = true;
        path = "${homeConfig.xdg.stateHome}/undo";
      };
      utility = {
        undotree = {
          enable = true;
        };
      };
    };
  };
}
