{
  delib,
  homeConfig,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.reload";

  options = delib.singleEnableOption true;

  home.ifEnabled = {myconfig, ...}: {
    home.packages = let
      tmux_reload = lib.optionalString homeConfig.programs.tmux.enable ''
        tmux source ${homeConfig.xdg.configHome}/tmux/tmux.conf && echo 'tmux reloaded';
      '';
      sketchybar_reload = lib.optionalString myconfig.services.sketchybar.enable ''
        ${lib.getExe pkgs.sketchybar} --reload && echo 'sketchybar reloaded';
      '';
      ghostty_reload = lib.optionalString (pkgs.stdenv.isDarwin && homeConfig.programs.ghostty.enable) ''
        osascript -e '${builtins.readFile ./reload_ghostty.applescript}' && echo 'ghostty reloaded';
      '';
      reload =
        [
          tmux_reload
          sketchybar_reload
          ghostty_reload
        ]
        |> lib.concatStrings
        |> pkgs.writeShellScriptBin "reload";
    in [reload];
  };
}
