{
  delib,
  homeConfig,
  ...
}:
delib.module {
  name = "programs.nh";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.nh = {
      enable = true;
      flake = "${homeConfig.home.homeDirectory}/.dotfiles";
    };
  };
}
