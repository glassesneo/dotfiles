{delib, ...}:
delib.module {
  name = "programs.nvf.languages";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf.settings.vim = {
      languages = {
        enableTreesitter = true;
      };
    };
  };
}
