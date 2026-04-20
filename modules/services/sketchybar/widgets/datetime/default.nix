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
      enabled =
        parent.enable
        && lib.any (section: lib.any (entry: entry.widget == name) parent.layout.${section}) parent.sections;
      handler = pkgs.replaceVars ./handler.nu {
        inherit name;
      };
    in {
      enable = boolOption enabled;
      handler = readOnly (packageOption handler);
      render = readOnly (packageOption (pkgs.replaceVars ./widget.nu {
        inherit name;
        script-path = null;
      }));
    });
}
