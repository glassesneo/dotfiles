{
  delib,
  inputs,
  lib,
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

    options = {
      wallpaper = lib.mkOption {
        type = lib.types.nullOr (lib.types.enum (builtins.attrNames wallpapers));
        default = null;
        description = "Path to the wallpaper image to set.";
      };
    };

    home.always = {myconfig, ...}: {
      programs.desktoppr.settings.picture = wallpapers.${myconfig.wallpaper};
    };
  }
