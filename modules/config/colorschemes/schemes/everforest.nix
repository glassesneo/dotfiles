{delib, ...}:
delib.module {
  name = "config.colorschemes.schemes.everforest";

  # Palette values derived from sainnhe/everforest commit d84d9ec8 (palette.md).
  # Mapping: base00=bg_dim, base01=bg0, base02=bg1, base03=grey0, base04=grey1,
  #          base05=fg, base06=grey2, base07=fg,
  #          base08=red, base09=orange, base0A=yellow, base0B=green,
  #          base0C=aqua, base0D=blue, base0E=purple, base0F=bg_visual.
  myconfig.always.colorschemes.everforest = {
    "dark-hard" = {
      polarity = "dark";
      base00 = "#1e2326";
      base01 = "#272e33";
      base02 = "#2e383c";
      base03 = "#7a8478";
      base04 = "#859289";
      base05 = "#d3c6aa";
      base06 = "#9da9a0";
      base07 = "#d3c6aa";
      base08 = "#e67e80";
      base09 = "#e69875";
      base0A = "#dbbc7f";
      base0B = "#a7c080";
      base0C = "#83c092";
      base0D = "#7fbbb3";
      base0E = "#d699b6";
      base0F = "#4c3743";
    };

    "dark-medium" = {
      polarity = "dark";
      base00 = "#232a2e";
      base01 = "#2d353b";
      base02 = "#343f44";
      base03 = "#7a8478";
      base04 = "#859289";
      base05 = "#d3c6aa";
      base06 = "#9da9a0";
      base07 = "#d3c6aa";
      base08 = "#e67e80";
      base09 = "#e69875";
      base0A = "#dbbc7f";
      base0B = "#a7c080";
      base0C = "#83c092";
      base0D = "#7fbbb3";
      base0E = "#d699b6";
      base0F = "#543a48";
    };

    "dark-soft" = {
      polarity = "dark";
      base00 = "#293136";
      base01 = "#333c43";
      base02 = "#3a464c";
      base03 = "#7a8478";
      base04 = "#859289";
      base05 = "#d3c6aa";
      base06 = "#9da9a0";
      base07 = "#d3c6aa";
      base08 = "#e67e80";
      base09 = "#e69875";
      base0A = "#dbbc7f";
      base0B = "#a7c080";
      base0C = "#83c092";
      base0D = "#7fbbb3";
      base0E = "#d699b6";
      base0F = "#5c3f4f";
    };
  };
}
