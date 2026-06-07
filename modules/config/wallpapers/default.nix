{
  delib,
  host,
  inputs,
  ...
}: let
  wallpapers = {
    "shape" = "${inputs.wallpapers}/generative/shape.png";
    "cave-sunset-view" = "${inputs.wallpapers}/minecraft/cave-sunset-view.png";
    "roses" = "${inputs.various-wallpapers}/onedark/J0FZ3V.jpg";
    "forest" = "${inputs.various-wallpapers}/everforest/651GE9.jpg";
    "sakura" = "${inputs.various-wallpapers}/onedark/3BY6U5.jpg";
  };
in
  delib.module {
    name = "config.wallpapers";

    options = with delib;
      moduleOptions {
        enable = boolOption host.guiShellFeatured;
        wallpaper = enumOption (builtins.attrNames wallpapers) "shape";
      };

    myconfig.ifEnabled = {cfg, ...}: {
      programs.desktoppr = {
        enable = true;
        wallpaper = wallpapers.${cfg.wallpaper};
      };
    };
  }
