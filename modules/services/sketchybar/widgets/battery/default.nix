{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "services.sketchybar.widget-battery";

  options = with delib;
    moduleOptions ({parent, ...}: let
      name = "battery";
      nushellBin = lib.getExe parent.nushellPackage;
      enabled =
        parent.enable
        && lib.any (section: lib.any (entry: entry.widget == name) parent.layout.${section}) parent.sections;
      handler = pkgs.replaceVars ./handler.nu {
        inherit name;
      };
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
}
