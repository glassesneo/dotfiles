{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "services.sketchybar";

  options.services.sketchybar = with delib; {
    enable = boolOption host.isDesktop;
    colors = {
      rosewater = strOption "";
      flamingo = strOption "";
      pink = strOption "";
      mauve = strOption "";
      red = strOption "";
      maroon = strOption "";
      peach = strOption "";
      yellow = strOption "";
      green = strOption "";
      teal = strOption "";
      sky = strOption "";
      sapphire = strOption "";
      blue = strOption "";
      lavender = strOption "";
      text = strOption "";
      subtext1 = strOption "";
      subtext0 = strOption "";
      overlay2 = strOption "";
      overlay1 = strOption "";
      overlay0 = strOption "";
      surface2 = strOption "";
      surface1 = strOption "";
      surface0 = strOption "";
      base = strOption "";
      mantle = strOption "";
      crust = strOption "";
    };
    # App-specific icon colors (separate from theme colors)
    appColors = {
      arc = strOption "";
      ghostty = strOption "";
      obsidian = strOption "";
      kitty = strOption "";
    };
    # Semantic colors for specific UI elements
    electricity = strOption ""; # AC power indicator
    # CPU graph colors by usage level
    cpuColors = {
      low = strOption ""; # 1-25%
      medium = strOption ""; # 26-50%
      high = strOption ""; # 51-75%
      critical = strOption ""; # 76-100%
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
    colorsNu = pkgs.replaceVars ./rc/colors.nu {
      # Theme colors
      rosewater = cfg.colors.rosewater;
      flamingo = cfg.colors.flamingo;
      pink = cfg.colors.pink;
      mauve = cfg.colors.mauve;
      red = cfg.colors.red;
      maroon = cfg.colors.maroon;
      peach = cfg.colors.peach;
      yellow = cfg.colors.yellow;
      green = cfg.colors.green;
      teal = cfg.colors.teal;
      sky = cfg.colors.sky;
      sapphire = cfg.colors.sapphire;
      blue = cfg.colors.blue;
      lavender = cfg.colors.lavender;
      text = cfg.colors.text;
      subtext1 = cfg.colors.subtext1;
      subtext0 = cfg.colors.subtext0;
      overlay2 = cfg.colors.overlay2;
      overlay1 = cfg.colors.overlay1;
      overlay0 = cfg.colors.overlay0;
      surface2 = cfg.colors.surface2;
      surface1 = cfg.colors.surface1;
      surface0 = cfg.colors.surface0;
      base = cfg.colors.base;
      mantle = cfg.colors.mantle;
      crust = cfg.colors.crust;
      # App-specific icon colors
      app_arc = cfg.appColors.arc;
      app_ghostty = cfg.appColors.ghostty;
      app_obsidian = cfg.appColors.obsidian;
      app_kitty = cfg.appColors.kitty;
      # Semantic colors
      electricity = cfg.electricity;
      # CPU graph colors
      cpu_low = cfg.cpuColors.low;
      cpu_medium = cfg.cpuColors.medium;
      cpu_high = cfg.cpuColors.high;
      cpu_critical = cfg.cpuColors.critical;
    };

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
