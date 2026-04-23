{
  delib,
  lib,
  ...
}: let
  colorPattern = "^#[0-9a-fA-F]{6}$";
  alphaPattern = "^[0-9a-fA-F]{2}$";

  isHexColor = value:
    builtins.isString value
    && builtins.match colorPattern value != null;

  normalizeHex = value:
    assert lib.assertMsg (builtins.isString value)
    "Invalid colorscheme color type '${builtins.typeOf value}', expected string #RRGGBB."; let
      normalized = lib.strings.toLower value;
    in
      assert lib.assertMsg (isHexColor normalized)
      "Invalid colorscheme color '${value}', expected #RRGGBB."; normalized;

  normalizeAlpha = value:
    assert lib.assertMsg (builtins.isString value)
    "Invalid alpha channel type '${builtins.typeOf value}', expected 2-digit hex string."; let
      normalized = lib.strings.toLower value;
    in
      assert lib.assertMsg (builtins.match alphaPattern normalized != null)
      "Invalid alpha channel '${value}', expected 2-digit hex string."; normalized;

  toArgb = alpha: hex: let
    normalizedAlpha = normalizeAlpha alpha;
    normalizedHex = normalizeHex hex;
    rgb = lib.strings.removePrefix "#" normalizedHex;
  in "0x${normalizedAlpha}${rgb}";

  toGhosttyPalette = colors: [
    "0=${colors.base00}"
    "1=${colors.base08}"
    "2=${colors.base0B}"
    "3=${colors.base0A}"
    "4=${colors.base0D}"
    "5=${colors.base0E}"
    "6=${colors.base0C}"
    "7=${colors.base05}"
    "8=${colors.base03}"
    "9=${colors.base08}"
    "10=${colors.base0B}"
    "11=${colors.base0A}"
    "12=${colors.base0D}"
    "13=${colors.base0E}"
    "14=${colors.base0C}"
    "15=${colors.base07}"
  ];
in
  delib.module {
    name = "config.colorschemes.lib";

    myconfig.always.args.shared.colorschemeLib = {
      inherit normalizeHex toArgb toGhosttyPalette;
    };
  }
