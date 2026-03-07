{
  colorschemeLib,
  delib,
  lib,
  ...
}: let
  mkColorOption = name:
    lib.mkOption {
      type = lib.types.str;
      apply = colorschemeLib.normalizeHex;
      example = "#1a1a1a";
      description = "Hex color value for ${name} in #RRGGBB format.";
    };

  paletteType = lib.types.submodule ({config, ...}: {
    options = {
      polarity = lib.mkOption {
        type = lib.types.enum ["dark" "light"];
        default = "dark";
        description = "Palette polarity for dark/light aware consumers.";
      };

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

      base10 = mkColorOption "base10";
      base11 = mkColorOption "base11";
      base12 = mkColorOption "base12";
      base13 = mkColorOption "base13";
      base14 = mkColorOption "base14";
      base15 = mkColorOption "base15";
      base16 = mkColorOption "base16";
      base17 = mkColorOption "base17";
    };

    config = {
      base10 = lib.mkDefault config.base08;
      base11 = lib.mkDefault config.base09;
      base12 = lib.mkDefault config.base0A;
      base13 = lib.mkDefault config.base0B;
      base14 = lib.mkDefault config.base0C;
      base15 = lib.mkDefault config.base0D;
      base16 = lib.mkDefault config.base0E;
      base17 = lib.mkDefault config.base0F;
    };
  });
in
  delib.module {
    name = "config.colorschemes";

    options = {
      colorschemes = lib.mkOption {
        type = lib.types.attrsOf (lib.types.attrsOf paletteType);
        default = {};
        description = "Colorscheme registry keyed by scheme name and variant.";
      };

      colorscheme = lib.mkOption {
        type = lib.types.nullOr paletteType;
        default = null;
        description = "Active colorscheme selected by the current rice.";
      };
    };

    myconfig.always = {myconfig, ...}: {
      args.shared.colorscheme = myconfig.colorscheme;
    };
  }
