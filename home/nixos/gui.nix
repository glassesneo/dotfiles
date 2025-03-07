{pkgs, ...}: {
  xdg.configFile = {
    "ghostty" = {
      source = ../../ghostty;
    };
  };

  home.packages = with pkgs; [
    # ghostty
  ];
}
