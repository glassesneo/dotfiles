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
      source = pkgs.replaceVars ./sketchybar_icon_map.sh {
        sketchybar-app-font = "${pkgs.sketchybar-app-font}/bin/icon_map.sh";
      };
    };
    home.packages = with pkgs; [
      sketchybar-app-font
      nerd-fonts.hack
    ];
  };
}
