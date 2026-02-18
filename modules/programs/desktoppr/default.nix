{
  delib,
  host,
  homeConfig,
  ...
}:
# desktoppr: macOS wallpaper utility
# Note: Wallpaper support via fetchurl in rice options causes infinite recursion.
# Use flake inputs, local files, or direct home.file config in rices instead.
#
# WORKAROUND: home-manager's desktoppr module writes to the wrong preference domain
# ("desktoppr" instead of "com.scriptingosx.desktoppr"). We fix this by copying
# the settings to the correct domain.
# See: https://github.com/nix-community/home-manager/issues/XXXX
delib.module {
  name = "programs.desktoppr";

  options = delib.singleEnableOption host.guiShellFeatured;

  home.ifEnabled = {
    programs.desktoppr = {
      enable = true;
      settings.setOnlyOnce = false;
    };

    # Fix: home-manager writes to "desktoppr" but the tool reads from
    # "com.scriptingosx.desktoppr". Mirror the settings to the correct domain.
    targets.darwin.defaults."com.scriptingosx.desktoppr" =
      homeConfig.programs.desktoppr.settings;
  };
}
