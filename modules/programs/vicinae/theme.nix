{
  colorscheme,
  delib,
  lib,
  ...
}: let
  palette = colorscheme.palette;
  themeId = "${colorscheme.name}-${colorscheme.variant}";
  themeDisplayName = "${lib.toSentenceCase colorscheme.name} ${lib.toSentenceCase colorscheme.variant}";
  hexColor = lib.types.strMatching "#[0-9a-fA-F]{6}";
  mkColorOption = default: optionDescription:
    with delib;
      description ((strOption default) // {type = hexColor;}) optionDescription;
in
  delib.module {
    name = "programs.vicinae.theme";

    options = with delib;
      moduleOptions {
        enable = description (boolOption false) "Enable a Vicinae theme derived from the selected colorscheme.";
        name = description ((strOption themeId) // {type = lib.types.strMatching "[A-Za-z0-9][A-Za-z0-9._-]*";}) "Theme identifier used for the generated Vicinae theme file.";
        display-name = description (strOption themeDisplayName) "Human-readable Vicinae theme name.";
        icon-theme = description (strOption "default") "Vicinae icon theme paired with the generated color theme.";
        colors.core = {
          background = mkColorOption palette.base00 "Primary launcher background.";
          foreground = mkColorOption palette.base05 "Primary launcher foreground.";
          secondary-background = mkColorOption palette.base01 "Secondary launcher background.";
          border = mkColorOption palette.base02 "Launcher border color.";
          accent = mkColorOption palette.base0D "Launcher accent color.";
        };
      };

    home.ifEnabled = {
      cfg,
      parent,
      ...
    }: let
      customSelection = {
        name = cfg.name;
        icon_theme = cfg.icon-theme;
      };
      builtInSelection = polarity: {
        name = "vicinae-${polarity}";
        icon_theme = cfg.icon-theme;
      };
    in {
      assertions = [
        {
          assertion = parent.enable;
          message = "myconfig.programs.vicinae.theme requires the Vicinae launcher backend.";
        }
      ];

      programs.vicinae = {
        themes.${cfg.name} = {
          meta = {
            version = 1;
            name = cfg.display-name;
            variant = colorscheme.polarity;
            inherits = "vicinae-${colorscheme.polarity}";
          };
          colors.core = {
            inherit (cfg.colors.core) background foreground border accent;
            secondary_background = cfg.colors.core.secondary-background;
          };
        };

        settings.theme = {
          dark =
            if colorscheme.polarity == "dark"
            then customSelection
            else builtInSelection "dark";
          light =
            if colorscheme.polarity == "light"
            then customSelection
            else builtInSelection "light";
        };
      };
    };
  }
