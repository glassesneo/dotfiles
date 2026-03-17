{delib, ...}:
delib.module {
  name = "nix-darwin.system.dock";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    system.defaults.dock = {
      autohide = true;
      autohide-delay = 1000.0;
      mouse-over-hilite-stack = true;
      orientation = "bottom";
      show-recents = false;
    };
  };
}
