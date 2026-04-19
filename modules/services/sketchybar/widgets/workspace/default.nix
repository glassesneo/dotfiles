{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "services.sketchybar.widget-workspace";

  options = with delib;
    moduleOptions ({
      myconfig,
      parent,
      ...
    }: let
      name = "workspace";
      nushellBin = lib.getExe parent.nushellPackage;
      enabled =
        parent.enable
        && (lib.any (section: lib.any (entry: entry.widget == name) parent.layout.${section}) parent.sections)
        && myconfig.services.aerospace.enable;
      handler = pkgs.replaceVars ./handler.nu {};
      script = pkgs.writeShellScript "script" ''
        exec ${nushellBin} ${handler}
      '';
    in {
      enable = boolOption enabled;
      render = readOnly (packageOption (pkgs.replaceVars ./widget.nu {
        inherit name;
        script-path = script;
      }));
    });

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
