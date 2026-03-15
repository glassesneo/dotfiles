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
    # Semantic color palette - typed submodule with strict validation
    colors = lib.mkOption {
      type = let
        colorType = lib.types.strMatching "0x[0-9a-fA-F]{8}";
      in
        lib.types.submodule {
          options = {
            bar_background = lib.mkOption {type = colorType;};
            text_primary = lib.mkOption {type = colorType;};
            text_muted = lib.mkOption {type = colorType;};
            workspace_active = lib.mkOption {type = colorType;};
            surface_background = lib.mkOption {type = colorType;};
            popup_background = lib.mkOption {type = colorType;};
            popup_border = lib.mkOption {type = colorType;};
            accent_datetime = lib.mkOption {type = colorType;};
            status_error = lib.mkOption {type = colorType;};
            status_warning = lib.mkOption {type = colorType;};
            status_caution = lib.mkOption {type = colorType;};
            status_success = lib.mkOption {type = colorType;};
            status_charging = lib.mkOption {type = colorType;};
            app_arc = lib.mkOption {type = colorType;};
            app_ghostty = lib.mkOption {type = colorType;};
            app_obsidian = lib.mkOption {type = colorType;};
            app_kitty = lib.mkOption {type = colorType;};
            cpu_low = lib.mkOption {type = colorType;};
            cpu_medium = lib.mkOption {type = colorType;};
            cpu_high = lib.mkOption {type = colorType;};
            cpu_critical = lib.mkOption {type = colorType;};
            island_surface = lib.mkOption {type = colorType;};
            island_border = lib.mkOption {type = colorType;};
            active_indicator = lib.mkOption {type = colorType;};
          };
        };
      default = {};
      description = "Semantic color palette for SketchyBar items and UI elements";
    };
    # Bar appearance
    bar = {
      position = lib.mkOption {
        type = lib.types.enum ["top" "bottom"];
        default =
          if host.hasNotch
          then "top"
          else "bottom";
        description = "Bar position. Defaults to top for notched hosts, bottom otherwise.";
      };
      color = strOption ""; # 0xAARRGGBB format
      cornerRadius = strOption "0";
      blurRadius = strOption "0";
      borderWidth = strOption "0";
      borderColor = strOption "";
      margin = strOption "8";
      shadow = strOption "on";
      notchWidth = lib.mkOption {
        type = lib.types.nullOr lib.types.int;
        default = null;
        description = "Override notch_width for notch-aware bar layout. Omitted when null.";
      };
      notchOffset = lib.mkOption {
        type = lib.types.nullOr lib.types.int;
        default = null;
        description = "Override notch_offset for notch-aware bar layout. Omitted when null.";
      };
      notchDisplayHeight = lib.mkOption {
        type = lib.types.nullOr lib.types.int;
        default =
          if host.hasNotch
          then 32
          else null;
        description = "Override notch_display_height for notch-aware bar layout. Omitted when null.";
      };
    };
    # Datetime font override (Family:Style:Size). When empty, uses Bold Italic default.
    datetimeFontOverride = strOption "";
    # Typed layout abstraction with zones and groups
    layout = let
      regionOverrideType = lib.types.nullOr (lib.types.enum ["left" "right" "center" "q" "e"]);
      zoneGroupType = lib.types.submodule {
        options = {
          id = lib.mkOption {type = lib.types.str;};
          priority = lib.mkOption {type = lib.types.int;};
          items = lib.mkOption {type = lib.types.listOf lib.types.str;};
          regionOverride = lib.mkOption {
            type = regionOverrideType;
            default = null;
            description = "When set, overrides the runtime SketchyBar position for all items in this group (e.g. q/e for notch-aware placement).";
          };
          bracket = {
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
        };
      };
    in let
      islandBracket = padding: {
        enable = true;
        cornerRadius = "12";
        borderWidth = "1";
        height = "28";
        paddingLeft = padding;
        paddingRight = padding;
      };
    in {
      zones = {
        left = lib.mkOption {
          type = lib.types.listOf zoneGroupType;
          default =
            if host.hasNotch
            then [
              {
                id = "island-left";
                priority = 1;
                items = ["/workspace\\..*/" "front_app"];
                bracket = islandBracket "8";
              }
            ]
            else [];
          description = "Left zone groups with deterministic ordering by priority";
        };
        center = lib.mkOption {
          type = lib.types.listOf zoneGroupType;
          default =
            if !host.hasNotch
            then [
              {
                id = "island";
                priority = 1;
                items = ["/workspace\\..*/" "front_app" "datetime" "battery" "cpu"];
                regionOverride = "center";
                bracket = islandBracket "12";
              }
            ]
            else [];
          description = "Center zone groups with deterministic ordering by priority";
        };
        right = lib.mkOption {
          type = lib.types.listOf zoneGroupType;
          default =
            if host.hasNotch
            then [
              {
                id = "island-right";
                priority = 1;
                items = ["datetime" "battery" "cpu"];
                bracket = islandBracket "8";
              }
            ]
            else [];
          description = "Right zone groups with deterministic ordering by priority";
        };
      };
    };
  };

  darwin.ifEnabled.services = {
    sketchybar = {
      enable = true;
      extraPackages = with pkgs; [nushell];
    };
  };

  home.ifEnabled = {cfg, ...}: let
    # Build replaceVars arguments from semantic color map
    colorsNu = pkgs.replaceVars ./rc/colors.nu cfg.colors;

    datetimeNu = pkgs.replaceVars ./rc/plugins/datetime.nu {
      datetime_font_lines =
        if cfg.datetimeFontOverride != ""
        then ''label.font="${cfg.datetimeFontOverride}"''
        else "label.font.style=\"Bold Italic\"\n        label.font.size=14";
    };

    # Derive workspace/front_app position from layout config
    workspacePosition = let
      allGroups = cfg.layout.zones.left ++ cfg.layout.zones.center ++ cfg.layout.zones.right;
      workspaceGroups = lib.filter (g: lib.any (i: i == "/workspace\\..*/") g.items) allGroups;
    in
      if workspaceGroups == []
      then "left"
      else if (lib.head workspaceGroups).regionOverride != null
      then (lib.head workspaceGroups).regionOverride
      else "left";

    workspaceNu = pkgs.replaceVars ./rc/plugins/workspace.nu {
      workspace_position = workspacePosition;
    };

    frontAppNu = pkgs.replaceVars ./rc/plugins/front_app.nu {
      front_app_position = workspacePosition;
    };

    # Generate bracket code for a group
    # When backgroundColor is empty, fall back to the island_surface runtime color token
    generateBracketCode = zone: group: let
      bgColor =
        if group.bracket.backgroundColor != ""
        then ''"${group.bracket.backgroundColor}"''
        else ''$"($colors.island_surface)"'';
      borderColor =
        if group.bracket.borderColor != ""
        then ''"${group.bracket.borderColor}"''
        else ''$"($colors.island_border)"'';
    in ''
      (
        sketchybar --add bracket "group.${zone}.${group.id}" ${lib.concatStringsSep " " (map lib.escapeShellArg group.items)}
          --set "group.${zone}.${group.id}"
            background.color=${bgColor}
            background.border_width=${group.bracket.borderWidth}
            background.border_color=${borderColor}
            background.corner_radius=${group.bracket.cornerRadius}
            background.height=${group.bracket.height}
            background.padding_left=${group.bracket.paddingLeft}
            background.padding_right=${group.bracket.paddingRight}
      )
    '';

    # Generate region override code for a group (post-creation --set position).
    # Runs after item creation, before --reorder; both are independent operations.
    generateRegionOverrideCode = group:
      if group.regionOverride != null
      then
        lib.concatMapStrings (item: ''
          sketchybar --set ${lib.escapeShellArg item} position=${lib.escapeShellArg group.regionOverride}
        '')
        group.items
      else "";

    # Helper to detect regex patterns in item lists (start with /)
    isRegexPattern = s: lib.hasPrefix "/" s;

    # Generate all layout code (brackets, region overrides, and reorder)
    generateLayoutCode = zone: groups: let
      sortedGroups = lib.sort (a: b: a.priority < b.priority) groups;
      bracketCodes = lib.concatMapStrings (g:
        if g.bracket.enable
        then generateBracketCode zone g
        else "# Bracket disabled for ${g.id}")
      sortedGroups;
      regionOverrideCodes = lib.concatMapStrings generateRegionOverrideCode sortedGroups;
      allItems = lib.concatMap (g: g.items) sortedGroups;
      # Only reorder literal item names; regex patterns are for brackets/overrides only
      literalItems = lib.filter (i: !isRegexPattern i) allItems;
      itemString = lib.concatStringsSep " " (map lib.escapeShellArg literalItems);
    in
      if allItems != []
      then ''
        ${bracketCodes}
        ${regionOverrideCodes}
        ${lib.optionalString (literalItems != []) "sketchybar --reorder ${itemString}"}
      ''
      else "# No items in ${zone} zone";

    layoutCode = ''
      ${generateLayoutCode "left" cfg.layout.zones.left}
      ${generateLayoutCode "center" cfg.layout.zones.center}
      ${generateLayoutCode "right" cfg.layout.zones.right}
    '';

    # Build conditional notch property lines (omitted when null)
    notchLines = let
      lines = lib.filter (s: s != "") [
        (lib.optionalString (cfg.bar.notchWidth != null) "notch_width=${toString cfg.bar.notchWidth}")
        (lib.optionalString (cfg.bar.notchOffset != null) "notch_offset=${toString cfg.bar.notchOffset}")
        (lib.optionalString (cfg.bar.notchDisplayHeight != null) "notch_display_height=${toString cfg.bar.notchDisplayHeight}")
      ];
    in
      lib.concatStringsSep "\n        " lines;

    sketchybarrc = pkgs.replaceVars ./rc/sketchybarrc {
      bar_position = cfg.bar.position;
      bar_color =
        if cfg.bar.color != ""
        then cfg.bar.color
        else "$\"($colors.bar_background)\"";
      bar_corner_radius = cfg.bar.cornerRadius;
      bar_blur_radius = cfg.bar.blurRadius;
      bar_border_width = cfg.bar.borderWidth;
      bar_border_color =
        if cfg.bar.borderColor != ""
        then cfg.bar.borderColor
        else "0x00000000";
      bar_margin = cfg.bar.margin;
      bar_shadow = cfg.bar.shadow;
      bar_notch_lines = notchLines;
      layout_code = layoutCode;
    };

    sketchybarConfig = pkgs.runCommand "sketchybar-config" {} ''
      mkdir -p $out
      cp -r ${./rc}/* $out/
      chmod -R +w $out
      cp ${colorsNu} $out/colors.nu
      cp ${sketchybarrc} $out/sketchybarrc
      cp ${datetimeNu} $out/plugins/datetime.nu
      cp ${workspaceNu} $out/plugins/workspace.nu
      cp ${frontAppNu} $out/plugins/front_app.nu
    '';
  in {
    assertions = let
      priorityAssertions =
        lib.mapAttrsToList (zone: groups: {
          assertion = let
            priorities = map (g: g.priority) groups;
          in
            lib.length priorities == lib.length (lib.unique priorities);
          message = "services.sketchybar.layout.zones.${zone}: group priorities must be unique";
        })
        cfg.layout.zones;

      idAssertions =
        lib.mapAttrsToList (zone: groups: {
          assertion = let
            ids = map (g: g.id) groups;
          in
            lib.length ids == lib.length (lib.unique ids);
          message = "services.sketchybar.layout.zones.${zone}: group IDs must be unique";
        })
        cfg.layout.zones;

      itemAssertions = let
        allItems = lib.concatLists (lib.mapAttrsToList (
            _: groups:
              lib.concatMap (g: g.items) groups
          )
          cfg.layout.zones);
      in [
        {
          assertion = lib.length allItems == lib.length (lib.unique allItems);
          message = "services.sketchybar.layout: all item names across all zones must be unique";
        }
      ];

      bracketAssertions =
        lib.mapAttrsToList (
          zone: groups:
            lib.concatMap (g: [
              {
                assertion = !g.bracket.enable || g.items != [];
                message = "services.sketchybar.layout.zones.${zone}.${g.id}: bracket.enable is true but group has no items";
              }
            ])
            groups
        )
        cfg.layout.zones;
    in
      lib.flatten (priorityAssertions ++ idAssertions ++ itemAssertions ++ bracketAssertions);

    home.file = {
      ".config/sketchybar" = {
        source = sketchybarConfig;
        recursive = true;
      };
    };
    xdg.configFile."sketchybar_icon_map.sh".text = ''
      source ${pkgs.sketchybar-app-font}/bin/icon_map.sh
      __icon_map "$1"
      echo "$icon_result"
    '';
    home.packages = with pkgs; [
      sketchybar-app-font
      nerd-fonts.hack
    ];
  };
}
