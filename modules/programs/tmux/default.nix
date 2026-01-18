{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.tmux";

  options.programs.tmux = with delib; {
    enable = boolOption true;
    # Rice-aware theming configuration
    theme = {
      plugin = strOption ""; # e.g., "catppuccin" - plugin name from tmuxPlugins
      pluginConfig = strOption ""; # Extra config for the plugin (set before plugin loads)
      extraConfig = strOption ""; # Custom tmux config (for non-plugin themes like monochrome)
    };
  };

  home.ifEnabled = {cfg, ...}: let
    keybinds_for_ghostty = [
      "cmd+t=csi:24~"
    ];

    # Validate plugin name if specified
    pluginExists = cfg.theme.plugin == "" || pkgs.tmuxPlugins ? ${cfg.theme.plugin};

    # Conditionally build tmux plugin from option
    themePlugins =
      if cfg.theme.plugin != ""
      then
        assert lib.assertMsg pluginExists
          "tmux theme plugin '${cfg.theme.plugin}' not found in pkgs.tmuxPlugins";
        [
          {
            plugin = pkgs.tmuxPlugins.${cfg.theme.plugin};
            extraConfig = cfg.theme.pluginConfig;
          }
        ]
      else [];
  in {
    programs.tmux = {
      enable = true;
      prefix = "F12";

      # Add theme plugin if specified
      plugins = themePlugins;

      extraConfig = ''
        set -g mouse on
        set -g default-terminal "tmux-256color"
        set -as terminal-features ',xterm-ghostty:RGB'
        run-shell -b '${lib.getExe pkgs.nushell} ${./config.nu}'

        # Rice-specific configuration
        ${cfg.theme.extraConfig}
      '';
    };
    programs.ghostty.settings.keybind = keybinds_for_ghostty;
  };
}
