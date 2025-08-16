{delib, ...}:
delib.module {
  name = "xdg";

  options.xdg = with delib; {
    enable = boolOption true;
  };

  home.ifEnabled = {
    xdg = {
      enable = true;
    };
  };
}
