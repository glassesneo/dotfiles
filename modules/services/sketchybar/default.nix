{
  delib,
  host,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "services.sketchybar";

  options.services.sketchybar = with delib; {
    enable = boolOption host.windowManagementFeatured;
    # Theme colors (Catppuccin naming) - all values use 0xAARRGGBB format
    colors = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = {};
      description = "Theme color palette (rosewater, flamingo, pink, mauve, red, maroon, peach, yellow, green, teal, sky, sapphire, blue, lavender, text, subtext1, subtext0, overlay2, overlay1, overlay0, surface2, surface1, surface0, base, mantle, crust)";
    };
    # App-specific icon colors (separate from theme colors)
    appColors = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = {};
      description = "App-specific icon colors (arc, ghostty, obsidian, kitty)";
    };
    # Semantic colors for specific UI elements
    electricity = strOption ""; # AC power indicator
    # CPU graph colors by usage level
    cpuColors = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = {};
      description = "CPU graph colors by usage level (low, medium, high, critical)";
    };
    # Bar appearance
    bar = {
      color = strOption ""; # 0xAARRGGBB format
      cornerRadius = strOption "0";
      blurRadius = strOption "0";
      borderWidth = strOption "0";
      borderColor = strOption "";
    };
    # Right item grouping/bracket
    rightBracket = {
      enable = boolOption false;
      backgroundColor = strOption "";
      blurRadius = strOption "0";
      borderWidth = strOption "0";
      borderColor = strOption "";
      cornerRadius = strOption "8";
      height = strOption "28";
      paddingLeft = strOption "0";
      paddingRight = strOption "0";
    };
    # Left item grouping/bracket
    leftBracket = {
      enable = boolOption false;
      backgroundColor = strOption "";
      borderWidth = strOption "0";
      borderColor = strOption "";
      cornerRadius = strOption "8";
      height = strOption "28";
      paddingLeft = strOption "0";
      paddingRight = strOption "0";
    };
  };

  darwin.ifEnabled.services = {
    sketchybar = {
      enable = true;
      extraPackages = with pkgs; [nushell];
    };
  };

  home.ifEnabled = {cfg, ...}: let
    # Build replaceVars arguments from attrsets
    # Theme colors use their names directly (e.g., rosewater -> @rosewater@)
    # App colors get prefixed with "app_" (e.g., arc -> @app_arc@)
    # CPU colors get prefixed with "cpu_" (e.g., low -> @cpu_low@)
    colorsNu = pkgs.replaceVars ./rc/colors.nu (
      cfg.colors
      // lib.mapAttrs' (name: value: lib.nameValuePair "app_${name}" value) cfg.appColors
      // lib.mapAttrs' (name: value: lib.nameValuePair "cpu_${name}" value) cfg.cpuColors
      // {electricity = cfg.electricity;}
    );

    # Generate right bracket code if enabled
    rightBracketCode =
      if cfg.rightBracket.enable
      then ''
        (
          sketchybar --add bracket right_bracket datetime battery cpu volume ai
            --set right_bracket
              background.color="${cfg.rightBracket.backgroundColor}"
              background.blur_radius=${cfg.rightBracket.blurRadius}
              background.border_width=${cfg.rightBracket.borderWidth}
              background.border_color="${cfg.rightBracket.borderColor}"
              background.corner_radius=${cfg.rightBracket.cornerRadius}
              background.height=${cfg.rightBracket.height}
              background.padding_left=${cfg.rightBracket.paddingLeft}
              background.padding_right=${cfg.rightBracket.paddingRight}
        )
      ''
      else "# Right bracket disabled";

    leftBracketCode =
      if cfg.leftBracket.enable
      then ''
        (
          sketchybar --add bracket left_bracket workspaces front_app front_app.app_list
            --set left_bracket
              background.color="${cfg.leftBracket.backgroundColor}"
              background.border_width=${cfg.leftBracket.borderWidth}
              background.border_color="${cfg.leftBracket.borderColor}"
              background.corner_radius=${cfg.leftBracket.cornerRadius}
              background.height=${cfg.leftBracket.height}
              background.padding_left=${cfg.leftBracket.paddingLeft}
              background.padding_right=${cfg.leftBracket.paddingRight}
        )
      ''
      else "# Left bracket disabled";

    sketchybarrc = pkgs.replaceVars ./rc/sketchybarrc {
      bar_color =
        if cfg.bar.color != ""
        then cfg.bar.color
        else "$\"($colors.crust)\"";
      bar_corner_radius = cfg.bar.cornerRadius;
      bar_blur_radius = cfg.bar.blurRadius;
      bar_border_width = cfg.bar.borderWidth;
      bar_border_color =
        if cfg.bar.borderColor != ""
        then cfg.bar.borderColor
        else "0x00000000";
      left_bracket_code = leftBracketCode;
      right_bracket_code = rightBracketCode;
    };

    sketchybarConfig = pkgs.runCommand "sketchybar-config" {} ''
      mkdir -p $out
      cp -r ${./rc}/* $out/
      chmod -R +w $out
      cp ${colorsNu} $out/colors.nu
      cp ${sketchybarrc} $out/sketchybarrc
    '';
  in {
    home.file = {
      ".config/sketchybar" = {
        source = sketchybarConfig;
        recursive = true;
      };
    };
    xdg.configFile."sketchybar_icon_map.sh" = {
      source = pkgs.replaceVars ./sketchybar_icon_map.sh {
        sketchybar-app-font = "${pkgs.sketchybar-app-font}/bin/icon_map.sh";
      };
    };
    home.packages = with pkgs; [
      sketchybar-app-font
      nerd-fonts.hack
    ];
  };
}
