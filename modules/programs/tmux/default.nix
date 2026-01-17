{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.tmux";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    keybinds_for_ghostty = [
      "cmd+t=csi:24~"
    ];
  in {
    programs.tmux = {
      enable = true;
      prefix = "F12";
      extraConfig = ''
        set -g mouse on
        set -g default-terminal "tmux-256color"
        set -as terminal-features ',xterm-ghostty:RGB'
        run-shell -b '${lib.getExe pkgs.nushell} ${./config.nu}'
      '';
    };
    programs.ghostty.settings.keybind = keybinds_for_ghostty;
  };
}
