{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.tmux-navigator";

  options = delib.singleEnableOption homeConfig.programs.tmux.enable;

  home.ifEnabled = {
    programs.nixvim.plugins.tmux-navigator = {
      enable = true;
      lazyLoad = {
        enable = true;
        settings = {
          cmd = [
            "TmuxNavigateLeft"
            "TmuxNavigateDown"
            "TmuxNavigateUp"
            "TmuxNavigateRight"
            "TmuxNavigatePrevious"
            "TmuxNavigatorProcessList"
          ];
          keys = [
            {
              __unkeyed-1 = "<C-h>";
              mode = ["n"];
            }
            {
              __unkeyed-1 = "<C-j>";
              mode = ["n"];
            }
            {
              __unkeyed-1 = "<C-k>";
              mode = ["n"];
            }
            {
              __unkeyed-1 = "<C-l>";
              mode = ["n"];
            }
            {
              __unkeyed-1 = "<C-\\>";
              mode = ["n"];
            }
          ];
        };
      };
    };
    programs.tmux.plugins = [
      pkgs.tmuxPlugins.vim-tmux-navigator
    ];
  };
}
