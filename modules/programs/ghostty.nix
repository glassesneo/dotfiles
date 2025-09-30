{
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
        then pkgs.brewCasks.ghostty
        else pkgs.ghostty;
      clearDefaultKeybinds = true;
      settings = {
        theme = "Catppuccin Mocha";
        font-size = 16;
        font-family = "UDEV Gothic NFLG";
        keybind = [
          # "cmd+t=new_tab"
          "cmd+c=copy_to_clipboard"
          "cmd+v=paste_from_clipboard"
        ];
        font-feature = "-dlig";
        background-opacity = 0.7;
        background-blur = 5;
        window-inherit-working-directory = false;
        macos-titlebar-style = "hidden";
      };
    };
  };
}
