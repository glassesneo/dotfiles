{
  xdg.configFile = {
    "ghostty" = {
      source = ../../ghostty;
    };
    "aerospace" = {
      source = ../../aerospace;
    };
  };
  # to avoid the symlink issue (https://github.com/FelixKratz/SketchyBar/issues/553#issuecomment-2471760488)
  home.file.".config/sketchybar" = {
    source = ../../sketchybar;
    recursive = false;
  };
}
