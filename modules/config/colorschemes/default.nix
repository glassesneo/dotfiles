{
  colorschemeLib,
  delib,
  lib,
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
  selectorModule = {
    options = with delib; {
      name = description (noDefault (strOption null)) "Colorscheme registry name.";
      variant = description (noDefault (strOption null)) "Variant within the selected colorscheme.";
    };
  };
  selection = myconfig: let
    inherit (myconfig.colorscheme) name variant;
    exists =
      builtins.hasAttr name myconfig.colorschemes
      && builtins.hasAttr variant myconfig.colorschemes.${name};
    message = "myconfig.colorscheme selector '${name}/${variant}' does not exist in myconfig.colorschemes.";
  in {
    inherit exists message name variant;
    resolved =
      if exists
      then myconfig.colorschemes.${name}.${variant}
      else throw message;
  };
  validateSelection = {myconfig, ...}: let
    selected = selection myconfig;
  in {
    assertions = [
      {
        assertion = selected.exists;
        message = selected.message;
      }
    ];
  };
in
  delib.module {
    name = "config.colorschemes";

    options = with delib; {
      colorschemes = description (attrsOfOption (attrsOf paletteType) {}) "Colorscheme registry keyed by scheme name and variant.";

      colorscheme = description (noDefault (submoduleOption selectorModule null)) "Required colorscheme selector resolved against the registry.";
    };

    myconfig.always = {myconfig, ...}: let
      selected = selection myconfig;
    in {
      args.shared.colorscheme =
        if selected.exists
        then {
          inherit (selected) name variant;
          inherit (selected.resolved) polarity;
          palette = lib.removeAttrs selected.resolved ["polarity"];
        }
        else throw selected.message;
    };

    home.always = validateSelection;
    darwin.always = validateSelection;
    nixos.always = validateSelection;
  }
