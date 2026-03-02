{
  delib,
  host,
  lib,
  ...
}:
delib.module {
  name = "services.jankyborders";

  options.services.jankyborders = with delib; {
    enable = boolOption host.windowManagementFeatured;
    style = lib.mkOption {
      type = lib.types.enum ["round" "square"];
      default = "round";
      description = "JankyBorders window border style";
    };
    active_color = lib.mkOption {
      type = lib.types.str;
      default = "0xffabb2bf";
      description = "JankyBorders active border color in ARGB hex (e.g. 0xffRRGGBB)";
    };
    inactive_color = lib.mkOption {
      type = lib.types.str;
      default = "0x00000000";
      description = "JankyBorders inactive border color in ARGB hex (e.g. 0xffRRGGBB)";
    };
    width = floatOption 5.0;
    order = lib.mkOption {
      type = lib.types.enum ["below" "above"];
      default = "below";
      description = "Whether JankyBorders should be rendered below or above window content";
    };
  };

  darwin.ifEnabled = {cfg, ...}: {
    services.jankyborders = {
      enable = true;
      inherit (cfg) style active_color inactive_color width order;
      whitelist = [
        "ghostty"
      ];
      hidpi = false;
    };
  };
}
