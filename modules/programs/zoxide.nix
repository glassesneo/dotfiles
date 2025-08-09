{delib, ...}:
delib.module {
  name = "programs.zoxide";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.zoxide = {
    enable = true;
    enableZshIntegration = true;
  };
}
