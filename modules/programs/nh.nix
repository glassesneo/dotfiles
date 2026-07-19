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
    home.sessionVariables.NH_SHOW_ACTIVATION_LOGS = "1";

    programs.nh = {
      enable = true;
      flake = "${homeConfig.home.homeDirectory}/.dotfiles";
    };
  };
}
