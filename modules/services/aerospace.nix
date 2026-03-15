{
  delib,
  host,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "services.aerospace";

  options.services.aerospace = with delib; {
    enable = boolOption host.windowManagementFeatured;
    # Apps that should default to tiling layout (most apps float by default)
    tilingApps = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [
        "company.thebrowser.Browser" # Arc Browser
        "com.mitchellh.ghostty" # Ghostty terminal
      ];
      description = "App bundle IDs that should use tiling layout by default";
    };
    # Which screen edge gets the large bar reserve. Defaults follow host.hasNotch
    # so notched hosts reserve the top (where SketchyBar sits) and non-notched
    # hosts reserve the bottom. Rices can override via myconfig.services.aerospace.reservedEdge.
    reservedEdge = lib.mkOption {
      type = lib.types.enum ["top" "bottom"];
      default =
        if host.hasNotch
        then "top"
        else "bottom";
      description = "Screen edge that receives the full bar reserve gap. Defaults to top for notched hosts, bottom otherwise. Should stay aligned with SketchyBar bar placement.";
    };
    # Size of the large reserved-edge gap, matching the SketchyBar bar height.
    reservedSize = lib.mkOption {
      type = lib.types.int;
      default = 42;
      description = "Size of the reserved-edge outer gap in pixels. Should match the SketchyBar bar height.";
    };
  };

  darwin.ifEnabled = {cfg, ...}: {
    services.aerospace = {
      enable = true;
      settings = let
        sketchybarExe = lib.getExe pkgs.sketchybar;
      in {
        exec-on-workspace-change = [
          "/bin/bash"
          "-c"
          "${sketchybarExe} --trigger aerospace_workspace_change FOCUSED_WORKSPACE=$AEROSPACE_FOCUSED_WORKSPACE"
        ];

        on-window-detected = let
          enableTiling = app-id: {
            "if".app-id = app-id;
            run = ["layout tiling"];
          };
        in
          [
            {
              check-further-callbacks = true;
              run = ["layout floating"];
            }
          ]
          ++ (map enableTiling cfg.tilingApps);

        enable-normalization-flatten-containers = true;
        enable-normalization-opposite-orientation-for-nested-containers = true;

        accordion-padding = 30;

        default-root-container-layout = "tiles";

        default-root-container-orientation = "auto";

        key-mapping.preset = "qwerty";

        on-focused-monitor-changed = ["move-mouse monitor-lazy-center"];

        gaps = let
          outerDefault = 4;
        in {
          inner.horizontal = 5;
          inner.vertical = 5;
          outer.left = outerDefault;
          outer.right = outerDefault;
          outer.top =
            if cfg.reservedEdge == "top"
            then [
              {monitor."built-in" = outerDefault;}
              cfg.reservedSize
            ]
            else outerDefault;
          outer.bottom =
            if cfg.reservedEdge == "bottom"
            then cfg.reservedSize
            else outerDefault;
        };

        workspace-to-monitor-force-assignment = {
          "1" = "main";
          "2" = "main";
          "3" = "main";
          "4" = "main";
          "5" = "main";
          A = ["secondary" "main"];
          B = ["secondary" "main"];
          C = ["secondary" "main"];
          D = ["secondary" "main"];
          E = ["secondary" "main"];
        };

        mode.main.binding = {
          alt-slash = "layout tiles horizontal vertical";
          alt-comma = "layout accordion horizontal vertical";

          alt-h = "focus left";
          alt-j = "focus down";
          alt-k = "focus up";
          alt-l = "focus right";

          alt-f = "layout tiling floating";
          alt-q = "close";

          alt-shift-h = "move left";
          alt-shift-j = "move down";
          alt-shift-k = "move up";
          alt-shift-l = "move right";

          alt-shift-minus = "resize smart -50";
          alt-shift-equal = "resize smart +50";

          alt-1 = "workspace 1";
          alt-2 = "workspace 2";
          alt-3 = "workspace 3";
          alt-4 = "workspace 4";
          alt-5 = "workspace 5";
          alt-a = "workspace A";
          alt-b = "workspace B";
          alt-c = "workspace C";
          alt-d = "workspace D";
          alt-e = "workspace E";

          alt-shift-1 = "move-node-to-workspace 1";
          alt-shift-2 = "move-node-to-workspace 2";
          alt-shift-3 = "move-node-to-workspace 3";
          alt-shift-4 = "move-node-to-workspace 4";
          alt-shift-5 = "move-node-to-workspace 5";
          alt-shift-a = "move-node-to-workspace A";
          alt-shift-b = "move-node-to-workspace B";
          alt-shift-c = "move-node-to-workspace C";
          alt-shift-d = "move-node-to-workspace D";
          alt-shift-e = "move-node-to-workspace E";

          alt-tab = "workspace-back-and-forth";
          alt-shift-tab = "move-workspace-to-monitor --wrap-around next";
        };

        mode.service.binding = {
          esc = [
            "reload-config"
            "mode main"
          ];
          alt-shift-h = [
            "join-with left"
            "mode main"
          ];
          alt-shift-j = [
            "join-with down"
            "mode main"
          ];
          alt-shift-k = [
            "join-with up"
            "mode main"
          ];
          alt-shift-l = [
            "join-with right"
            "mode main"
          ];
        };
      };
    };
  };
}
