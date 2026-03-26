{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "services.sketchybar.widget-datetime";

  options = with delib;
    moduleOptions ({parent, ...}: let
      name = "datetime";
      sections = ["a" "b" "c" "x" "y" "z"];
      nushellBin = lib.getExe parent.nushellPackage;
      enabled =
        parent.enable
        && lib.any (section: lib.any (entry: entry.widget == name) parent.layout.${section}) sections;
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
