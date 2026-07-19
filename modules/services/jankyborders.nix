{
  delib,
  host,
  tiers,
  ...
}:
delib.module {
  name = "services.jankyborders";

  options = with delib;
    moduleOptions {
      enable = boolOption host.guiShellFeatured;
      style = description (enumOption ["round" "square"] "round") "JankyBorders window border style";
      active_color = description (strOption "0xffabb2bf") "JankyBorders active border color in ARGB hex (e.g. 0xffRRGGBB)";
      inactive_color = description (strOption "0x00000000") "JankyBorders inactive border color in ARGB hex (e.g. 0xffRRGGBB)";
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
