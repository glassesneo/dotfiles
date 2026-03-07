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
  };
in
  delib.module {
    name = "config.wallpapers";

    options = {
      wallpaper = lib.mkOption {
        type = lib.types.nullOr <| lib.types.enum (builtins.attrNames wallpapers);
        default = null;
        description = "Path to the wallpaper image to set.";
      };
    };

    home.always = {myconfig, ...}: {
      programs.desktoppr.settings.picture = wallpapers.${myconfig.wallpaper};
    };
  }
