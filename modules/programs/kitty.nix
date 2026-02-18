{
  delib,
  host,
  homeConfig,
  lib,
  ...
}:
delib.module {
  name = "programs.kitty";

  options = delib.singleEnableOption host.guiShellFeatured;

  home.ifEnabled.programs.kitty = {
    enable = true;
    quickAccessTerminalConfig = {
      hide_on_focus_loss = true;
      enable_audio_bell = false;
      font_family = "UDEV Gothic NFLG";
      bold_font = "auto";
      italic_font = "auto";
      bold_italic_font = "auto";
      font_size = 12;
      edge = "center-sized";
    };
  };
}
