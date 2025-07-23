{pkgs, ...}: {
  programs.ghostty = {
    enable = true;
    package = pkgs.brewCasks.ghostty;
    # clearDefaultKeybinds = true;
    settings = {
      theme = "catppuccin-mocha";
      font-size = 16;
      font-family = "UDEV Gothic NFLG";
      keybind = [
        "cmd+t=new_tab"
      ];
      font-feature = "-dlig";
      background-opacity = 0.9;
      background-blur = 5;
      window-inherit-working-directory = false;
      macos-titlebar-style = "hidden";
    };
  };
}
