{
  delib,
  homeConfig,
  host,
  ...
}:
delib.module {
  name = "programs.nh";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = {
    programs.nh = {
      enable = true;
      flake = "${homeConfig.home.homeDirectory}/.dotfiles";
    };
  };
}
