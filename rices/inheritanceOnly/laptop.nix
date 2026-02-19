{delib, ...}:
delib.rice {
  name = "laptop";

  inheritanceOnly = true;

  home = {
    programs = {
      ghostty = {
        settings = {
          font-size = 16;
          font-family = "UDEV Gothic NFLG";
        };
      };
    };
  };
}
