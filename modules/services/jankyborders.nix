{
  colorscheme,
  colorschemeLib,
  delib,
  host,
  lib,
  pkgs,
  tccStableBinaries,
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

    myconfig.ifEnabled.system.tcc-stable-binaries.entries.borders = {
      source = "${pkgs.jankyborders}/bin/borders";
      scope = "user";
    };

    darwin.ifEnabled = {cfg, ...}: let
      hi-spec-flag = tiers.atLeast host.tier "standard";
      optionalArg = arg: value:
        if value != null && value != ""
        then
          if lib.isList value
          then map (val: "${arg}=${val}") value
          else ["${arg}=${value}"]
        else [];
    in {
      services.jankyborders = {
        enable = true;
        inherit (cfg) style active_color inactive_color width order;
        hidpi = hi-spec-flag;
        ax_focus = hi-spec-flag;
      };

      launchd.user.agents.jankyborders.serviceConfig.ProgramArguments = lib.mkForce (
        [
          tccStableBinaries.resolved.borders
        ]
        ++ (optionalArg "width" (toString cfg.width))
        ++ (optionalArg "hidpi" (
          if hi-spec-flag
          then "on"
          else "off"
        ))
        ++ (optionalArg "active_color" cfg.active_color)
        ++ (optionalArg "inactive_color" cfg.inactive_color)
        ++ (optionalArg "style" cfg.style)
        ++ (optionalArg "ax_focus" (
          if hi-spec-flag
          then "on"
          else "off"
        ))
        ++ (optionalArg "order" cfg.order)
      );
    };
  }
