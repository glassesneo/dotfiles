{
  delib,
  lib,
  ...
}: let
  solarizedStyles = let
    backgrounds = ["" "light" "dark"];
    palettes = ["" "solarized" "selenized"];
    variants = ["" "spring" "summer" "autumn" "winter"];
  in
    lib.filter (style: style != "") (lib.mapCartesianProduct ({
      bg,
      palette,
      variant,
    }:
      lib.concatStringsSep "-" (lib.filter (part: part != "") [bg palette variant])) {
      bg = backgrounds;
      palette = palettes;
      variant = variants;
    });

  supportedThemes = {
    base16 = [];
    mini-base16 = [];
    onedark = ["dark" "darker" "cool" "deep" "warm" "warmer"];
    gruber-darker = ["dark"];
    tokyonight = ["day" "night" "storm" "moon"];
    dracula = [];
    catppuccin = ["auto" "latte" "frappe" "macchiato" "mocha"];
    oxocarbon = ["dark" "light"];
    gruvbox = ["dark" "light"];
    rose-pine = ["main" "moon" "dawn"];
    nord = [];
    github = [
      "dark"
      "light"
      "dark_dimmed"
      "dark_default"
      "light_default"
      "dark_high_contrast"
      "light_high_contrast"
      "dark_colorblind"
      "light_colorblind"
      "dark_tritanopia"
      "light_tritanopia"
    ];
    solarized = solarizedStyles;
    solarized-osaka = [];
    everforest = ["hard" "medium" "soft"];
    mellow = [];
  };

  allStyles = lib.unique (lib.concatLists (builtins.attrValues supportedThemes));
  base16Names = map (suffix: "base0${suffix}") [
    "0"
    "1"
    "2"
    "3"
    "4"
    "5"
    "6"
    "7"
    "8"
    "9"
    "A"
    "B"
    "C"
    "D"
    "E"
    "F"
  ];
  hexColor = lib.types.strMatching "#[0-9a-fA-F]{6}";
  base16Module = {
    options = lib.genAttrs base16Names (name:
      lib.mkOption {
        type = lib.types.nullOr hexColor;
        default = null;
        description = "Base16 color ${name} in #RRGGBB format.";
      });
  };
in
  delib.module {
    name = "programs.nvf.theme";

    options = with delib;
      moduleOptions {
        enable = description (boolOption false) "Enable nvf theming.";
        name = description (enumOption (builtins.attrNames supportedThemes) "onedark") "Built-in nvf theme to use.";
        style = description (enumOption allStyles "darker") "Theme-specific style. Ignored when the selected theme has no styles.";
        transparent = description (boolOption false) "Enable background transparency when supported by the selected theme.";
        extraConfig = description ((strOption "") // {type = lib.types.lines;}) "Lua inserted before the selected theme's setup.";
        base16-colors = description (submoduleOption base16Module {}) "Base16 palette used by the base16 themes.";
      };

    home.ifEnabled = {cfg, ...}: let
      selectedStyles = supportedThemes.${cfg.name};
      usesBase16 = builtins.elem cfg.name ["base16" "mini-base16"];
      configuredBase16Colors = lib.filterAttrs (_: value: value != null) cfg.base16-colors;
      missingBase16Colors = lib.filter (name: cfg.base16-colors.${name} == null) base16Names;
    in {
      assertions = [
        {
          assertion = selectedStyles == [] || builtins.elem cfg.style selectedStyles;
          message = "myconfig.programs.nvf.theme.style '${cfg.style}' is not supported by theme '${cfg.name}'.";
        }
        {
          assertion = !usesBase16 || missingBase16Colors == [];
          message = "myconfig.programs.nvf.theme.base16-colors must define all 16 colors for theme '${cfg.name}'; missing: ${lib.concatStringsSep ", " missingBase16Colors}.";
        }
      ];

      programs.nvf.settings.vim.theme =
        {
          enable = true;
          inherit (cfg) name transparent extraConfig;
        }
        // lib.optionalAttrs (selectedStyles != []) {
          inherit (cfg) style;
        }
        // lib.optionalAttrs usesBase16 {
          base16-colors = configuredBase16Colors;
        };
    };
  }
