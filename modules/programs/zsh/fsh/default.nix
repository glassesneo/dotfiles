{delib, ...}:
delib.module {
  name = "programs.zsh.fsh";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.zsh.fastSyntaxHighlighting = {
      enable = true;
    };
  };
}
