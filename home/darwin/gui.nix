{ pkgs, ... }: {
  xdg.configFile = {
    "kitty" = {
        source = ../../kitty;
      };
  };

  home.packages = with pkgs; [
    # ghostty
    discord
    kitty
    # raycast
    slack
    zed-editor
    # zoom
  ];
}

