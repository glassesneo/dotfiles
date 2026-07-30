{
  delib,
  inputs,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.smart-splits";

  options = with delib;
    moduleOptions ({
      parent,
      myconfig,
      ...
    }: {
      enable = boolOption (parent.enable && myconfig.programs.tmux.enable);
    });

  home.ifEnabled = let
    # Same resolution nvf uses for lazy.plugins.smart-splits.package = "smart-splits".
    smartSplitsPackage =
      (inputs.nvf.inputs.mnw.lib.npinsToPluginsAttrs pkgs
        "${inputs.nvf}/npins/sources.json")
      .smart-splits;
  in {
    programs.nvf.settings.vim = {
      utility.smart-splits = {
        enable = true;
      };
    };
    programs.tmux = {
      extraConfig = ''
        # Do not wrap from the outermost pane to the opposite side.
        set -g @smart-splits_no_wrap '1'

        # Navigation without prefix.
        set -g @smart-splits_move_left_key  'C-h'
        set -g @smart-splits_move_down_key  'C-j'
        set -g @smart-splits_move_up_key    'C-k'
        set -g @smart-splits_move_right_key 'C-l'

        # Resizing without prefix.
        set -g @smart-splits_resize_left_key  'M-h'
        set -g @smart-splits_resize_down_key  'M-j'
        set -g @smart-splits_resize_up_key    'M-k'
        set -g @smart-splits_resize_right_key 'M-l'
        set -g @smart-splits_resize_step_size '3'

        run-shell "${smartSplitsPackage}/smart-splits.tmux"
      '';
    };
  };
}
