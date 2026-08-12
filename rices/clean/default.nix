{delib, ...}:
delib.rice {
  name = "clean";
  inherits = ["laptop"];

  myconfig = {
    colorscheme = {
      name = "monochrome";
      variant = "default";
    };
    darwin.window-manager.backend = "aerospace";
    wallpaper.title = "shape";
    programs.nvf.theme = {
      enable = true;
      transparent = false;
    };
    services.jankyborders.enable = false;
  };
}
