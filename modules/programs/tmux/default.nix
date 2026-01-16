{delib, ...}:
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
      extraConfig = builtins.readFile ./tmux.conf;
    };
    programs.ghostty.settings.keybind = keybinds_for_ghostty;
  };
}
