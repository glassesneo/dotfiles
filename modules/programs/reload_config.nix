{
  delib,
  homeConfig,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.reload_config";

  options = delib.singleEnableOption true;

  home.ifEnabled = {myconfig, ...}: {
    home.packages = let
      tmux_reload =
        lib.optionalString homeConfig.programs.tmux.enable
        "tmux source ${homeConfig.xdg.configHome}/tmux/tmux.conf";
      sketchybar_reload =
        lib.optionalString myconfig.services.sketchybar.enable
        "${lib.getExe pkgs.sketchybar} --reload";
      ghostty_reload = lib.optionalString (pkgs.stdenv.isDarwin && homeConfig.programs.ghostty.enable) ''
        osascript -e 'tell application "Ghostty" to activate' \
          -e 'tell application "System Events" to key code 43 using {command down, shift down}' \
      '';
      reload_config =
        [
          tmux_reload
          sketchybar_reload
          ghostty_reload
        ]
        |> lib.concatStringsSep " && "
        |> pkgs.writeShellScriptBin "reload_config";
    in [reload_config];
  };
}
