{delib, ...}:
delib.rice {
  name = "vivid";
  inherits = ["laptop"];

  myconfig = {
    colorscheme = {
      name = "catppuccin";
      variant = "macchiato";
    };
    darwin.window-manager.backend = "rift";
    wallpaper.title = "sakura";

    programs = {
      ghostty = {
        appearance = {
          background-opacity = 0.34;
          background-blur = 2;
          padding-x = 8;
          padding-y = 6;
          minimum-contrast = 1.8;
          animate-shaders = true;
        };
        shader-profile = "sakura_ink_ripple";
      };
      nvf.theme = {
        enable = true;
        transparent = true;
      };
    };

    services.jankyborders = {
      enable = true;
      style = "round";
      width = 2.0;
      order = "above";
    };
  };
}
