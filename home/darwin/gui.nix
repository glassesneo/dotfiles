{pkgs, ...}: {
  xdg.configFile = {
    "kitty" = {
      source = ../../kitty;
    };
  };

  home.packages = with pkgs; [
    # ghostty
    # discord
    # kitty
    # maccy
    # slack
    # zed-editor
    # zoom
  ];
}
