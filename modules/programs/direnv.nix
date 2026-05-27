{
  delib,
  host,
  ...
}:
delib.module {
  name = "programs.direnv";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = {
    programs.direnv = {
      enable = true;
      enableBashIntegration = true;
      enableZshIntegration = true;
      nix-direnv.enable = true;
    };
  };
}
