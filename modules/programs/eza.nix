{delib, ...}:
delib.module {
  name = "programs.eza";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.eza = {
    enable = true;
    enableZshIntegration = true;
    git = true;
    icons = "auto";
  };
}
