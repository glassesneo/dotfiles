{
  delib,
  host,
  ...
}:
delib.module {
  name = "programs.kitty";

  options = delib.singleEnableOption host.guiShellFeatured;

  home.ifEnabled.programs.kitty = {
    enable = true;
    keybindings = {
      "shift+enter" = "send_text normal,application \\e[13;2u";
    };
    quickAccessTerminalConfig = {
      hide_on_focus_loss = true;
      enable_audio_bell = false;
      font_family = "UDEV Gothic NFLG";
      bold_font = "auto";
      italic_font = "auto";
      bold_italic_font = "auto";
      font_size = 13;
      edge = "center-sized";
    };
  };
}
