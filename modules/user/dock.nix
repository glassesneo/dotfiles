{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "user.dock";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  home.ifEnabled = {
    targets.darwin.defaults."com.apple.dock" = {
      autohide = true;
      autohide-delay = 1000.0;
      mouse-over-hilite-stack = true;
      orientation = "bottom";
      persistent-apps = [];
      persistent-others = [];
      show-recents = false;
      static-only = true;
    };

    # Dock caches these keys until it restarts.
    home.activation.restartDock = homeConfig.lib.dag.entryAfter ["setDarwinDefaults" "writeBoundary"] ''
      /usr/bin/killall Dock 2>/dev/null || true
    '';
  };
}
