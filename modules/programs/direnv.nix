{delib, ...}:
delib.module {
  name = "programs.direnv";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.direnv = {
      enable = true;
      enableBashIntegration = true;
      enableZshIntegration = true;
      nix-direnv.enable = true;
    };
  };
}
