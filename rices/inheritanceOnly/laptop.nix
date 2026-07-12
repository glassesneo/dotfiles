{delib, ...}:
delib.rice {
  name = "laptop";

  inheritanceOnly = true;

  myconfig.programs.ghostty.appearance = {
    font-size = 16;
    font-family = "UDEV Gothic NFLG";
  };
}
