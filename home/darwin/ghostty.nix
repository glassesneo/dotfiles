{pkgs, ...}: {
  programs.ghostty = {
    enable = true;
    package = pkgs.brewCasks.ghostty;
    # clearDefaultKeybinds = true;
    settings = {
      theme = "catppuccin-mocha";
      font-size = 14.5;
      font-family = "UDEV Gothic 35JPDOC";
      keybind = [
        "cmd+t=new_tab"
      ];
      font-feature = "-dlig";
      background-opacity = 0.8;
      background-blur = 10;
      window-inherit-working-directory = false;
      macos-titlebar-style = "hidden";
    };
  };
}
