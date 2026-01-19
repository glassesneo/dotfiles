{delib, ...}:
# desktoppr: macOS wallpaper utility
# Note: Wallpaper support via fetchurl in rice options causes infinite recursion.
# Use flake inputs, local files, or direct home.file config in rices instead.
delib.module {
  name = "programs.desktoppr";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.desktoppr = {
    enable = true;
  };
}
