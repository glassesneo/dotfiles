{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.zellij";

  options.programs.zellij = with delib; {
    enable = boolOption false;
  };

  home.ifEnabled = {
    programs.zellij = {
      enable = true;
    };
    xdg.configFile = {
      "zellij/config.kdl".source = pkgs.replaceVars ./config.kdl {
        homeDirectory = homeConfig.home.homeDirectory;
      };
    };
  };
}
