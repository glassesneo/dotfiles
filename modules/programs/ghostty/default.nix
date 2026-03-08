{
  brewCasks,
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.ghostty";

  options.programs.ghostty = with delib; {
    enable = boolOption host.guiShellFeatured;
  };

  home.ifEnabled = {myconfig, ...}: {
    programs.ghostty = {
      enable = true;
      package =
        if myconfig.brew-nix.enable
        then brewCasks.ghostty
        else pkgs.ghostty;
      clearDefaultKeybinds = true;
      settings = {
        keybind = [
          "cmd+shift+,=reload_config"
          "cmd+z=undo"
          "cmd+shift+z=redo"
          "cmd+c=copy_to_clipboard"
          "cmd+shift+c=copy_url_to_clipboard"
          "cmd+v=paste_from_clipboard"
          "cmd+shift+p=toggle_command_palette"
          "global:cmd+backquote=toggle_quick_terminal"
        ];
        quick-terminal-position = "center";
        quick-terminal-size = "45%";
        quick-terminal-autohide = true;
        auto-update = "off";
        font-feature = "-dlig";
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
