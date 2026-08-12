{
  colorscheme,
  colorschemeLib,
  delib,
  host,
  tiers,
  ...
}: let
  activeAccent =
    if colorscheme.name == "catppuccin"
    then colorscheme.palette.base0F
    else if colorscheme.name == "everforest"
    then colorscheme.palette.base0B
    else colorscheme.palette.base05;
  activeColor = colorschemeLib.toArgb "ff" activeAccent;
  inactiveColor = colorschemeLib.toArgb "00" colorscheme.palette.base00;
in
  delib.module {
    name = "services.jankyborders";

    options = with delib;
      moduleOptions {
        enable = boolOption host.guiShellFeatured;
        style = description (enumOption ["round" "square"] "round") "JankyBorders window border style";
        active_color = description (strOption activeColor) "JankyBorders active border color in 0xAARRGGBB format";
        inactive_color = description (strOption inactiveColor) "JankyBorders inactive border color in 0xAARRGGBB format";
        width = floatOption 5.0;
        order = description (enumOption ["below" "above"] "below") "Whether JankyBorders should be rendered below or above window content";
      };

    darwin.ifEnabled = {cfg, ...}: {
      services.jankyborders = let
        hi-spec-flag = tiers.atLeast host.tier "standard";
      in {
        enable = true;
        inherit (cfg) style active_color inactive_color width order;
        hidpi = hi-spec-flag;
        ax_focus = hi-spec-flag;
      };
    };
  }
