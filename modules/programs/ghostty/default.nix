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
    neovide_sakura = [
      "${./cursor_warp.glsl}"
      "${./typing_sakura_petals.glsl}"
    ];
    sakura_ink_ripple = [
      "${./cursor_ink_ripple.glsl}"
      "${./typing_sakura_petals.glsl}"
    ];
  };
in
  delib.module {
    name = "programs.ghostty";

    options.programs.ghostty = with delib; {
      enable = boolOption host.guiShellFeatured;
      appearance = {
        font-family = strOption "";
        font-size = lib.mkOption {
          type = lib.types.nullOr lib.types.number;
          default = null;
        };
        background-opacity = lib.mkOption {
          type = lib.types.nullOr lib.types.number;
          default = null;
        };
        background-blur = lib.mkOption {
          type = lib.types.nullOr lib.types.int;
          default = null;
        };
        background = strOption "";
        foreground = strOption "";
        cursor = strOption "";
        selection-background = strOption "";
        selection-foreground = strOption "";
        padding-x = lib.mkOption {
          type = lib.types.nullOr lib.types.int;
          default = null;
        };
        padding-y = lib.mkOption {
          type = lib.types.nullOr lib.types.int;
          default = null;
        };
        minimum-contrast = lib.mkOption {
          type = lib.types.nullOr lib.types.number;
          default = null;
        };
        animate-shaders = boolOption false;
        palette = lib.mkOption {
          type =
            lib.types.addCheck
            (lib.types.listOf (lib.types.strMatching "^#[0-9a-fA-F]{6}$"))
            (palette: palette == [] || builtins.length palette == 16);
          default = [];
          description = "ANSI terminal palette colors in index order; empty uses Ghostty defaults.";
        };
      };
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
        settings =
          {
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
            desktop-notifications = true;
            window-inherit-working-directory = false;
            macos-titlebar-style = "hidden";
            background-opacity-cells = true;
            # cursor-style = "block";
            cursor-style-blink = false;
            shell-integration-features = "no-cursor";
            custom-shader = lib.mkIf (cfg.shader-profile != null) shaderProfiles.${cfg.shader-profile};
          }
          // lib.filterAttrs (_: value: value != null && value != "" && value != []) {
            font-family = cfg.appearance.font-family;
            font-size = cfg.appearance.font-size;
            background-opacity = cfg.appearance.background-opacity;
            background-blur = cfg.appearance.background-blur;
            background = cfg.appearance.background;
            foreground = cfg.appearance.foreground;
            cursor-color = cfg.appearance.cursor;
            selection-background = cfg.appearance.selection-background;
            selection-foreground = cfg.appearance.selection-foreground;
            window-padding-x = cfg.appearance.padding-x;
            window-padding-y = cfg.appearance.padding-y;
            minimum-contrast = cfg.appearance.minimum-contrast;
            palette = lib.imap0 (index: color: "${toString index}=${color}") cfg.appearance.palette;
          }
          // lib.optionalAttrs cfg.appearance.animate-shaders {custom-shader-animation = true;};
      };
    };
  }
