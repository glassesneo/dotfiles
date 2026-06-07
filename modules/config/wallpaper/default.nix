{
  delib,
  host,
  inputs,
  ...
}:
delib.module {
  name = "wallpaper";

  options = let
    wallpapers = {
      "shape" = "${inputs.wallpapers}/generative/shape.png";
      "cave-sunset-view" = "${inputs.wallpapers}/minecraft/cave-sunset-view.png";
      "roses" = "${inputs.various-wallpapers}/onedark/J0FZ3V.jpg";
      "forest" = "${inputs.various-wallpapers}/everforest/651GE9.jpg";
      "sakura" = "${inputs.various-wallpapers}/onedark/3BY6U5.jpg";
    };
  in
    with delib;
      moduleOptions {
        enable = boolOption host.guiShellFeatured;
        wallpapers = readOnly (attrsOfOption path wallpapers);
        title = enumOption (builtins.attrNames wallpapers) "shape";
      };

  myconfig.ifEnabled = {cfg, ...}: {
    programs.desktoppr = {
      enable = true;
      picture = cfg.wallpapers.${cfg.title};
    };
  };
}
