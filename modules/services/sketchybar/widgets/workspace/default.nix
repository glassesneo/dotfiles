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

  home.ifEnabled = lib.mkIf windowManager.isRift {
    launchd.agents.sketchybar-workspace-rift-subscriber = {
      enable = true;
      config = {
        Label = "com.neo.sketchybar.workspace.rift-subscriber";
        ProgramArguments = [
          pkgs.runtimeShell
          "${pkgs.replaceVars ./rift-subscriber.sh {
            runtime-shell = pkgs.runtimeShell;
            rift-cli = windowManager.rift.cli;
            rift-exe = windowManager.rift.executable;
            sketchybar-exe = lib.getExe pkgs.sketchybar;
          }}"
        ];
        RunAtLoad = true;
        KeepAlive = {
          Crashed = true;
          SuccessfulExit = false;
        };
        ThrottleInterval = 5;
        LimitLoadToSessionType = "Aqua";
        ProcessType = "Interactive";
        StandardOutPath = "${homeConfig.xdg.stateHome}/sketchybar/workspace-rift-subscriber.log";
        StandardErrorPath = "${homeConfig.xdg.stateHome}/sketchybar/workspace-rift-subscriber.err";
      };
    };
  };
}
