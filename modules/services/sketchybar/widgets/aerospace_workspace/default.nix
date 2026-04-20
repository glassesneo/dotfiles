{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "services.sketchybar.widget-aerospace_workspace";

  options = with delib;
    moduleOptions ({
      myconfig,
      parent,
      ...
    }: let
      name = "aerospace_workspace";
      enabled =
        parent.enable
        && (lib.any (section: lib.any (entry: entry.widget == name) parent.layout.${section}) parent.sections)
        && myconfig.services.aerospace.enable;
      handler = pkgs.replaceVars ./handler.nu {};
    in {
      enable = boolOption enabled;
      handler = readOnly (packageOption handler);
      render = readOnly (packageOption (pkgs.replaceVars ./widget.nu {
        inherit name;
        script-path = null;
      }));
    });

  # The widget's `enable` requires Aerospace to be active, so this Aerospace-
  # side CLI hook only fires when the widget is actually rendered. Changing the
  # enable predicate (e.g. relaxing the services.aerospace.enable gate) would
  # silently start injecting this hook on non-Aerospace hosts.
  darwin.ifEnabled = let
    sketchybarExe = lib.getExe pkgs.sketchybar;
  in {
    services.aerospace.settings.exec-on-workspace-change = [
      "/bin/bash"
      "-c"
      "${sketchybarExe} --trigger aerospace_workspace_change FOCUSED_WORKSPACE=$AEROSPACE_FOCUSED_WORKSPACE PREV_WORKSPACE=$AEROSPACE_PREV_WORKSPACE"
    ];
  };
}
