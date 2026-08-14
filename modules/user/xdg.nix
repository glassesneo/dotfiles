{delib, ...}:
delib.module {
  name = "user.xdg";

  options.user.xdg = with delib; {
    enable = boolOption true;
  };

  home.ifEnabled = {
    xdg = {
      enable = true;
    };
  };
}
