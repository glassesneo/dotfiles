{
  xdg.enable = true;

  home = {
    username = builtins.getEnv "USER";
    homeDirectory = builtins.getEnv "HOME";
  };

  programs.home-manager.enable = true;
}
