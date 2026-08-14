{
  delib,
  lib,
  spicePkgs,
  ...
}: let
  catppuccinAccents = [
    "rosewater"
    "flamingo"
    "pink"
    "maroon"
    "red"
    "peach"
    "yellow"
    "green"
    "teal"
    "sapphire"
    "blue"
    "sky"
    "mauve"
    "lavender"
  ];
in
  delib.module {
    name = "programs.spicetify.theme";

    options = with delib;
      moduleOptions ({myconfig, ...}: let
        colorscheme = myconfig.args.shared.colorscheme;
        automaticTheme =
          if colorscheme.name == "catppuccin"
          then {
            name = "catppuccin";
            colorScheme = colorscheme.variant;
          }
          else {
            name = "default";
            colorScheme = "";
          };
        builtInThemes = lib.remove "spotifyNoPremium" (builtins.attrNames spicePkgs.themes);
      in {
        enable = description (boolOption false) "Enable Spicetify theming.";
        name = description (enumOption builtInThemes automaticTheme.name) "Built-in spicetify-nix theme to use.";
        colorScheme = description (strOption automaticTheme.colorScheme) "Theme-specific color scheme.";
        accentColor = description (allowNull (enumOption catppuccinAccents null)) "Catppuccin color used for active controls; null keeps the upstream theme styling.";
        accentColorOverride = description (allowNull ((strOption null) // {type = lib.types.strMatching "#[0-9a-fA-F]{6}";})) "Optional #RRGGBB override for the selected Catppuccin accent.";
      });

    home.ifEnabled = {cfg, ...}: let
      selectedTheme = spicePkgs.themes.${cfg.name};
      accentValue =
        if cfg.accentColorOverride != null
        then cfg.accentColorOverride
        else "var(--spice-${cfg.accentColor})";
      accentCss = lib.optionalString (cfg.accentColor != null) ''
        :root {
          --myconfig-spicetify-accent: ${accentValue};
          --spice-button: var(--myconfig-spicetify-accent);
          --spice-button-active: var(--myconfig-spicetify-accent);
          --spice-equalizer: url('${cfg.colorScheme}/equalizer-animated-${cfg.accentColor}.gif');
        }

        :root .Root__now-playing-bar .main-shuffleButton-button.main-shuffleButton-active,
        :root .Root__now-playing-bar .main-repeatButton-button.main-repeatButton-active,
        :root .control-button-heart[aria-checked="true"],
        :root .main-addButton-active,
        :root .main-trackList-trackListRow.main-trackList-active .main-trackList-rowTitle {
          color: var(--myconfig-spicetify-accent) !important;
        }

        :root .Root__now-playing-bar .x-progressBar-progressBarBg > div > div,
        :root #sidebar-submenu .toggle-switch:has(.toggle-slider[style*="left: 22px"]) {
          background-color: var(--myconfig-spicetify-accent) !important;
        }

        :root .Root__now-playing-bar .main-playButton-PlayButton.main-playButton-primary,
        :root .Root__now-playing-bar .main-playButton-PlayButton.main-playButton-primary * {
          --background-highlight: var(--myconfig-spicetify-accent) !important;
          --background-press: var(--myconfig-spicetify-accent) !important;
        }
      '';
    in {
      assertions = [
        {
          assertion = cfg.name != "catppuccin" || builtins.elem cfg.colorScheme ["latte" "frappe" "macchiato" "mocha"];
          message = "myconfig.programs.spicetify.theme.colorScheme '${cfg.colorScheme}' is not supported by the Catppuccin theme.";
        }
        {
          assertion = cfg.accentColor == null || cfg.name == "catppuccin";
          message = "myconfig.programs.spicetify.theme.accentColor is only supported by the Catppuccin theme.";
        }
        {
          assertion = cfg.accentColorOverride == null || cfg.accentColor != null;
          message = "myconfig.programs.spicetify.theme.accentColorOverride requires accentColor.";
        }
      ];

      programs.spicetify = {
        theme =
          selectedTheme
          // lib.optionalAttrs (cfg.accentColor != null) {
            additionalCss = lib.concatLines [(selectedTheme.additionalCss or "") accentCss];
          };
        inherit (cfg) colorScheme;
      };
    };
  }
