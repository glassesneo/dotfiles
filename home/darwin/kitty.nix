{
  programs.kitty = {
    enable = true;
    font = {
      name = "HackGen Console NF";
      size = 16.5;
    };
    themeFile = "Catppuccin-Mocha";
    keybindings = {
      "kitty_mod+t" = "new_tab";
      "kitty_mod+shift+[" = "previous_tab";
      "kitty_mod+shift+]" = "next_tab";
      "kitty_mod+c" = "copy_to_clipboard";
      "kitty_mod+v" = "paste_from_clipboard";
      "kitty_mod+q" = "quit";
    };
    settings = {
      background_opacity = 0.45;
      scrollback_lines = 10000;
      enabled_layouts = "Grid";
      disable_ligatures = "never";
      tab_bar_edge = "top";
      tab_bar_style = "powerline";
      tab_powerline_style = "slanted";
      window_padding_width = 5;
      hide_window_decorations = "titlebar-only";
      clear_all_shortcuts = "yes";
      kitty_mod = "cmd";
      macos_option_as_alt = "yes";
      macos_quit_when_last_window_closed = "yes";
      macos_traditional_fullscreen = "yes";
      confirm_os_window_close = 0;
    };
  };
}
