{pkgs, ...}: {
  programs.ghostty = {
    enable = true;
    package = pkgs.brewCasks.ghostty;
    # clearDefaultKeybinds = true;
    settings = {
      theme = "catppuccin-mocha";
      font-size = 15;
      font-family = "Hackgen Console NF";
      keybind = [
        "cmd+t=new_tab"
      ];
      font-feature = "-dlig";
      background-opacity = 0.8;
      background-blur = 20;
      window-inherit-working-directory = false;
      macos-titlebar-style = "hidden";
    };
  };
}
