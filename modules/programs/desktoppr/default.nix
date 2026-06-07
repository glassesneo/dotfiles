{delib, ...}:
# desktoppr: macOS wallpaper utility
# WORKAROUND: home-manager's desktoppr module writes to the wrong preference domain
# ("desktoppr" instead of "com.scriptingosx.desktoppr"). We fix this by copying
# the settings to the correct domain.
# See: https://github.com/nix-community/home-manager/issues/XXXX
delib.module {
  name = "programs.desktoppr";

  options = with delib;
    moduleOptions {
      enable = boolOption false;
      picture = allowNull (allowStr (pathOption null));
    };

  home.ifEnabled = {cfg, ...}: rec {
    programs.desktoppr = {
      enable = true;
      settings = {
        inherit (cfg) picture;
        setOnlyOnce = false;
      };
    };

    # Fix: home-manager writes to "desktoppr" but the tool reads from
    # "com.scriptingosx.desktoppr". Mirror the settings to the correct domain.
    targets.darwin.defaults = {
      "com.scriptingosx.desktoppr" = programs.desktoppr.settings;
    };
  };
}
