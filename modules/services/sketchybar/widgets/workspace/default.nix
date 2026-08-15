{
  delib,
  homeConfig,
  lib,
  pkgs,
  windowManager,
  ...
}:
delib.module {
  name = "services.sketchybar.widget-workspace";

  options = with delib;
    moduleOptions ({parent, ...}: let
      name = "workspace";
      enabled =
        parent.enable
        && windowManager.enable
        && (lib.any (section: lib.any (entry: entry.widget == name) parent.layout.${section}) parent.sections);
      handler = pkgs.replaceVars ./handler.nu {
        backend = windowManager.backend;
        aerospace-exe = windowManager.aerospace.executable;
        rift-cli = windowManager.rift.cli;
      };
    in {
      enable = boolOption enabled;
      handler = readOnly (packageOption handler);
      render = readOnly (packageOption (pkgs.replaceVars ./widget.nu {
        inherit name;
        script-path = null;
      }));
      runtimeFiles = readOnly (attrsOfOption path {
        "providers/aerospace.nu" = ./providers/aerospace.nu;
        "providers/rift.nu" = ./providers/rift.nu;
        "rift-event-bridge.sh" = pkgs.replaceVars ./rift-event-bridge.sh {
          sketchybar-exe = lib.getExe pkgs.sketchybar;
        };
      });
    });

  darwin.ifEnabled = let
    sketchybarExe = lib.getExe pkgs.sketchybar;
  in {
    services.aerospace.settings.exec-on-workspace-change = lib.mkIf windowManager.isAerospace [
      "/bin/bash"
      "-c"
      "${sketchybarExe} --trigger workspace_change FOCUSED_WORKSPACE=$AEROSPACE_FOCUSED_WORKSPACE PREV_WORKSPACE=$AEROSPACE_PREV_WORKSPACE"
    ];
  };

  # The workspace widget contributes one native subscription command; the
  # Rift owner remains the sole writer of settings.run_on_start.
  myconfig.ifEnabled.services.rift.startupCommands = lib.optionals windowManager.isRift (let
    riftSubscribeOnStart = pkgs.writeShellApplication {
      name = "sketchybar-workspace-rift-subscribe-on-start";
      text = builtins.readFile ./rift-subscribe-on-start.sh;
    };
    stableEventBridge = "${homeConfig.home.homeDirectory}/.config/sketchybar/widgets/workspace/rift-event-bridge.sh";
  in [
    "${lib.getExe riftSubscribeOnStart} ${windowManager.rift.cli} ${stableEventBridge}"
  ]);
}
