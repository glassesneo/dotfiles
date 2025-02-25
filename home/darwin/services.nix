{pkgs, ...}: {
  # $env.SKETCHYBAR_APP_FONT_PATH = "${pkgs.sketchybar-app-font}"
  # to avoid the symlink issue (https://github.com/FelixKratz/SketchyBar/issues/553#issuecomment-2471760488)
  home.file = {
    ".config/sketchybar" = {
      source = ../../sketchybar;
      recursive = false;
    };
  };
  xdg.configFile."sketchybar_icon_map.sh" = {
    text =
      builtins.readFile "${pkgs.sketchybar-app-font}/bin/icon_map.sh"
      + ''
        __icon_map "$1"
        echo "$icon_result"
      '';
  };
}
