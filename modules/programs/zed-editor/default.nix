{
  delib,
  host,
  inputs,
  pkgs,
  ...
}:
delib.module {
  name = "programs.zed-editor";

  options = delib.singleEnableOption host.guiShellFeatured;

  home.always.imports = [
    inputs.zed-extensions.homeManagerModules.default
  ];

  home.ifEnabled = {
    programs.zed-editor = {
      enable = true;
      extraPackages = with pkgs; [
        nixd
      ];
      userSettings = {
        vim_mode = true;
        "experimental.theme_overrides" = {
          "background" = "#000000b5";
          "background.appearance" = "blurred";
          "editor.background" = "#00000000";
          "editor.gutter.background" = "#00000000";
          "panel.background" = "#00000000";
          "surface.background" = "#00000090";
          "elevated_surface.background" = "#000000f0";
          "tab_bar.background" = "#00000000";
          "tab.inactive_background" = "#00000000";
          "tab.active_background" = "#3f3f4650";
          "toolbar.background" = "#00000000";
          "status_bar.background" = "#00000090";
          "title_bar.background" = "#00000070";
        };
      };
    };
    programs.zed-editor-extensions = {
      enable = true;
      packages = with pkgs.zed-extensions; [
        nix
      ];
    };
  };
}
