{
  colorschemeLib,
  delib,
  host,
  lib,
  ...
}:
delib.module {
  name = "programs.kitty";

  options = with delib;
    moduleOptions ({myconfig, ...}: let
      colorscheme = myconfig.args.shared.colorscheme;
      automaticTheme =
        if colorscheme.name == "catppuccin"
        then "Catppuccin-${lib.toSentenceCase colorscheme.variant}"
        else if colorscheme.name == "everforest" && lib.hasPrefix "dark-" colorscheme.variant
        then "everforest_${builtins.replaceStrings ["-"] ["_"] colorscheme.variant}"
        else null;
    in {
      enable = boolOption host.guiShellFeatured;
      theme-file = allowNull (strOption automaticTheme);
    });

  home.ifEnabled = {
    cfg,
    myconfig,
    ...
  }: let
    palette = myconfig.args.shared.colorscheme.palette;
    terminalPalette = colorschemeLib.toTerminalPalette palette;
    ansiSettings = builtins.listToAttrs (lib.imap0 (index: color: {
        name = "color${toString index}";
        value = color;
      })
      terminalPalette);
    paletteSettings =
      {
        foreground = palette.base05;
        background = palette.base00;
        selection_foreground = palette.base05;
        selection_background = palette.base02;
        cursor = palette.base05;
        cursor_text_color = palette.base00;
      }
      // ansiSettings;
  in {
    programs.kitty =
      {
        enable = true;
        settings =
          {
            clear_all_shortcuts = true;
          }
          // lib.optionalAttrs (cfg.theme-file == null) paletteSettings;
        keybindings = {
          "shift+enter" = "send_text normal,application \\e[13;2u";
          "cmd+c" = "copy_or_noop";
          "cmd+v" = "paste_from_clipboard";
          "cmd+q" = "quit";
        };
        font = {
          name = "PlemolJP Console NF";
          size = 15;
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
      }
      // lib.optionalAttrs (cfg.theme-file != null) {
        themeFile = cfg.theme-file;
      };
  };
}
