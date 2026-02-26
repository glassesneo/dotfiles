{
  delib,
  host,
  homeConfig,
  lib,
  ...
}:
# desktoppr: macOS wallpaper utility
# WORKAROUND: home-manager's desktoppr module writes to the wrong preference domain
# ("desktoppr" instead of "com.scriptingosx.desktoppr"). We fix this by copying
# the settings to the correct domain.
# See: https://github.com/nix-community/home-manager/issues/XXXX
delib.module {
  name = "programs.desktoppr";

  options = delib.singleEnableOption host.guiShellFeatured;

  home.ifEnabled = {
    myconfig,
    cfg,
    ...
  }: let
    wallpaperSet = myconfig.wallpaper != null;
    moduleEnabled = cfg.enable && wallpaperSet;
  in {
    programs.desktoppr = {
      enable = moduleEnabled;
      settings = {
        setOnlyOnce = false;
      }
        // lib.optionalAttrs wallpaperSet {
          picture = myconfig.wallpaper;
        };
    };

    # Fix: home-manager writes to "desktoppr" but the tool reads from
    # "com.scriptingosx.desktoppr". Mirror the settings to the correct domain.
    targets.darwin.defaults = lib.optionalAttrs moduleEnabled {
      "com.scriptingosx.desktoppr" = homeConfig.programs.desktoppr.settings;
    };
  };
}
