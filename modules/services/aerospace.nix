{
  delib,
  host,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "services.aerospace";

  options = delib.singleEnableOption host.isDesktop;

  darwin.ifEnabled.services.aerospace = {
    enable = true;
    settings = let
      sketchybarExe = lib.getExe pkgs.sketchybar;
      bordersExe = lib.getExe pkgs.jankyborders;
    in {
      after-login-command = [];
      after-startup-command = [
        "exec-and-forget ${sketchybarExe}"
        "exec-and-forget ${bordersExe}"
      ];

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
        ++ (["company.thebrowser.Browser" "com.mitchellh.ghostty"]
          |> map enableTiling);

      enable-normalization-flatten-containers = true;
      enable-normalization-opposite-orientation-for-nested-containers = true;

      accordion-padding = 30;

      default-root-container-layout = "tiles";

      default-root-container-orientation = "auto";

      key-mapping.preset = "qwerty";

      on-focused-monitor-changed = ["move-mouse monitor-lazy-center"];

      gaps = {
        inner.horizontal = 10;
        inner.vertical = 10;
        outer.left = 5;
        outer.bottom = 48;
        outer.top = 5;
        outer.right = 5;
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

        alt-shift-semicolon = "mode service";
      };

      mode.service.binding = {
        esc = [
          "reload-config"
          "mode main"
        ];
        r = [
          "flatten-workspace-tree"
          "mode main"
        ]; # reset layout
        f = [
          "layout floating tiling"
          "mode main"
        ]; # Toggle between floating and tiling layout
        backspace = [
          "close-all-windows-but-current"
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
}
