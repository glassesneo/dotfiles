{
  brewCasks,
  delib,
  host,
  lib,
  pkgs,
  ...
}: let
  shaderProfiles = {
    neovide_sparks = [
      "${./cursor_warp.glsl}"
      "${./typing_micro_sparks.glsl}"
    ];
  };
in
  delib.module {
    name = "programs.ghostty";

    options.programs.ghostty = with delib; {
      enable = boolOption host.guiShellFeatured;
      shader-profile = lib.mkOption {
        type = lib.types.nullOr (lib.types.enum (builtins.attrNames shaderProfiles));
        default = null;
      };
    };

    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: {
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
          auto-update = "off";
          font-feature = "-dlig";
          window-inherit-working-directory = false;
          macos-titlebar-style = "hidden";
          background-opacity-cells = true;
          # cursor-style = "block";
          cursor-style-blink = false;
          shell-integration-features = "no-cursor";
          custom-shader = lib.mkIf (cfg.shader-profile != null) shaderProfiles.${cfg.shader-profile};
        };
      };
    };
  }
