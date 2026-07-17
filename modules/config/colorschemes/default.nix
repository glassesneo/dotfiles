{
  colorschemeLib,
  delib,
  ...
}: let
  mkColorOption = name:
    with delib;
      description (apply (noDefault (strOption null)) colorschemeLib.normalizeHex) "Hex color value for ${name} in #RRGGBB format."
      // {example = "#1a1a1a";};

  paletteModule = {config, ...}: {
    options = {
      polarity = with delib; description (enumOption ["dark" "light"] "dark") "Palette polarity for dark/light aware consumers.";

      base00 = mkColorOption "base00";
      base01 = mkColorOption "base01";
      base02 = mkColorOption "base02";
      base03 = mkColorOption "base03";
      base04 = mkColorOption "base04";
      base05 = mkColorOption "base05";
      base06 = mkColorOption "base06";
      base07 = mkColorOption "base07";
      base08 = mkColorOption "base08";
      base09 = mkColorOption "base09";
      base0A = mkColorOption "base0A";
      base0B = mkColorOption "base0B";
      base0C = mkColorOption "base0C";
      base0D = mkColorOption "base0D";
      base0E = mkColorOption "base0E";
      base0F = mkColorOption "base0F";
    };
  };
  paletteType = delib.submodule paletteModule;
in
  delib.module {
    name = "config.colorschemes";

    options = with delib; {
      colorschemes = description (attrsOfOption (attrsOf paletteType) {}) "Colorscheme registry keyed by scheme name and variant.";

      colorscheme = description (allowNull (submoduleOption paletteModule null)) "Active colorscheme selected by the current rice.";
    };

    myconfig.always = {myconfig, ...}: {
      args.shared.colorscheme = myconfig.colorscheme;
    };
  }
