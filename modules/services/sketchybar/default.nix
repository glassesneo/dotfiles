{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "services.sketchybar";

  options = delib.singleEnableOption host.isDesktop;

  darwin.ifEnabled.services = {
    sketchybar = {
      enable = true;
      extraPackages = with pkgs; [nushell];
    };
  };

  home.ifEnabled = {
    home.file = {
      ".config/sketchybar" = {
        source = ./rc;
        recursive = false;
      };
    };
    xdg.configFile."sketchybar_icon_map.sh" = {
      text = ''
        source ${pkgs.sketchybar-app-font}/bin/icon_map.sh
        __icon_map "$1"
        echo "$icon_result"
      '';
    };
  };
}
