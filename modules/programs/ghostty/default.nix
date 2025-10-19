{
  brewCasks,
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.ghostty";

  options.programs.ghostty = with delib; {
    enable = boolOption true;
  };

  home.ifEnabled = {
    myconfig,
    cfg,
    ...
  }: {
    programs.ghostty = {
      enable = cfg.enable;
      package =
        if myconfig.brew-nix.enable
        then brewCasks.ghostty
        else pkgs.ghostty;
      clearDefaultKeybinds = true;
      settings = {
        theme = "Catppuccin Mocha";
        font-size = 16;
        font-family = "UDEV Gothic NFLG";
        keybind = [
          "cmd+c=copy_to_clipboard"
          "cmd+v=paste_from_clipboard"
        ];
        auto-update = "off";
        font-feature = "-dlig";
        background-opacity = 0.7;
        background-blur = 5;
        window-inherit-working-directory = false;
        macos-titlebar-style = "hidden";
        # cursor-style = "block";
        cursor-style-blink = false;
        shell-integration-features = "no-cursor";
        # custom-shader = "${./cursor_trail.glsl}";
        # custom-shader-animation = true;
      };
    };
  };
}
