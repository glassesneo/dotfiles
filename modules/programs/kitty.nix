{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.kitty";

  options = delib.singleEnableOption host.guiShellFeatured;

  home.ifEnabled.programs.kitty = {
    enable = true;
    settings = {
      clear_all_shortcuts = true;
    };
    keybindings = {
      "shift+enter" = "send_text normal,application \\e[13;2u";
      "cmd+c" = "copy_or_noop";
      "cmd+v" = "paste_from_clipboard";
      "cmd+q" = "quit";
    };
    font = {
      name = "Maple Mono Normal NF CN";
      size = 14;
    };
    quickAccessTerminalConfig = {
      hide_on_focus_loss = true;
      enable_audio_bell = false;
      font_family = "UDEV Gothic NFLG";
      bold_font = "auto";
      italic_font = "auto";
      bold_italic_font = "auto";
      font_size = 14;
      edge = "center-sized";
    };
  };
}
