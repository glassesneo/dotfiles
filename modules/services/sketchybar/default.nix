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
          };
        };
      default = {};
      description = "Semantic color palette for SketchyBar items and UI elements";
    };
    # Bar appearance
    bar = {
      color = strOption ""; # 0xAARRGGBB format
      cornerRadius = strOption "0";
      blurRadius = strOption "0";
      borderWidth = strOption "0";
      borderColor = strOption "";
    };
    # Datetime font override (Family:Style:Size). When empty, uses Bold Italic default.
    datetimeFontOverride = strOption "";
    # Typed layout abstraction with zones and groups
    layout = {
      zones = {
        left = lib.mkOption {
          type = lib.types.listOf (lib.types.submodule {
            options = {
              id = lib.mkOption {type = lib.types.str;};
              priority = lib.mkOption {type = lib.types.int;};
              items = lib.mkOption {type = lib.types.listOf lib.types.str;};
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
          });
          default = [
            {
              id = "primary";
              priority = 1;
              items = ["workspaces" "front_app"];
              bracket.enable = false;
            }
          ];
          description = "Left zone groups with deterministic ordering by priority";
        };
        center = lib.mkOption {
          type = lib.types.listOf (lib.types.submodule {
            options = {
              id = lib.mkOption {type = lib.types.str;};
              priority = lib.mkOption {type = lib.types.int;};
              items = lib.mkOption {type = lib.types.listOf lib.types.str;};
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
          });
          default = [];
          description = "Center zone groups with deterministic ordering by priority";
        };
        right = lib.mkOption {
          type = lib.types.listOf (lib.types.submodule {
            options = {
              id = lib.mkOption {type = lib.types.str;};
              priority = lib.mkOption {type = lib.types.int;};
              items = lib.mkOption {type = lib.types.listOf lib.types.str;};
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
          });
          default = [
            {
              id = "primary";
              priority = 1;
              items = ["datetime" "battery" "cpu" "volume"];
              bracket.enable = false;
            }
          ];
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
        else "label.font.style=\"Bold Italic\"\n        label.font.size=16";
    };

    # Generate bracket code for a group
    generateBracketCode = zone: group: ''
      (
        sketchybar --add bracket "group.${zone}.${group.id}" ${lib.concatStringsSep " " (map lib.escapeShellArg group.items)}
          --set "group.${zone}.${group.id}"
            background.color="${group.bracket.backgroundColor}"
            background.blur_radius=${group.bracket.blurRadius}
            background.border_width=${group.bracket.borderWidth}
            background.border_color="${group.bracket.borderColor}"
            background.corner_radius=${group.bracket.cornerRadius}
            background.height=${group.bracket.height}
            background.padding_left=${group.bracket.paddingLeft}
            background.padding_right=${group.bracket.paddingRight}
      )
    '';

    # Generate all layout code (brackets and reorder)
    generateLayoutCode = zone: groups: let
      sortedGroups = lib.sort (a: b: a.priority < b.priority) groups;
      bracketCodes = lib.concatMapStrings (g:
        if g.bracket.enable
        then generateBracketCode zone g
        else "# Bracket disabled for ${g.id}")
      sortedGroups;
      allItems = lib.concatMap (g: g.items) sortedGroups;
      itemString = lib.concatStringsSep " " (map lib.escapeShellArg allItems);
    in
      if allItems != []
      then ''
        ${bracketCodes}
        sketchybar --reorder ${itemString}
      ''
      else "# No items in ${zone} zone";

    layoutCode = ''
      ${generateLayoutCode "left" cfg.layout.zones.left}
      ${generateLayoutCode "center" cfg.layout.zones.center}
      ${generateLayoutCode "right" cfg.layout.zones.right}
    '';

    sketchybarrc = pkgs.replaceVars ./rc/sketchybarrc {
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
      layout_code = layoutCode;
    };

    sketchybarConfig = pkgs.runCommand "sketchybar-config" {} ''
      mkdir -p $out
      cp -r ${./rc}/* $out/
      chmod -R +w $out
      cp ${colorsNu} $out/colors.nu
      cp ${sketchybarrc} $out/sketchybarrc
      cp ${datetimeNu} $out/plugins/datetime.nu
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
