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
      extraConfig = ''
        mouse = on
        bind h select-pane -L
        bind j select-pane -D
        bind k select-pane -U
        bind l select-pane -R

        bind H split-window -h -b -c "#{pane_current_path}"
        bind L split-window -h     -c "#{pane_current_path}"
        bind K split-window -v -b -c "#{pane_current_path}"
        bind J split-window -v     -c "#{pane_current_path}"
      '';
    };
    programs.ghostty.settings.keybind = keybinds_for_ghostty;
  };
}
