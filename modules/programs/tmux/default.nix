{
  delib,
  host,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.tmux";

  options.programs.tmux = with delib; {
    enable = boolOption host.devCoreFeatured;
    prefix = strOption "F12";
    extraConfigFragments = attrsOfOption lib.types.str {};
    # Rice-aware theming configuration
    theme = {
      plugin = strOption ""; # e.g., "catppuccin" - plugin name from tmuxPlugins
      pluginConfig = strOption ""; # Extra config for the plugin (set before plugin loads)
      extraConfig = strOption ""; # Custom tmux config (for non-plugin themes like monochrome)
    };
  };

  myconfig.always = {cfg, ...}: {
    args.shared.tmux.prefix = cfg.prefix;
  };

  home.ifEnabled = {cfg, ...}: let
    # Validate plugin name if specified
    pluginExists = cfg.theme.plugin == "" || pkgs.tmuxPlugins ? ${cfg.theme.plugin};

    # Conditionally build tmux plugin from option
    themePlugins =
      if cfg.theme.plugin != ""
      then
        assert lib.assertMsg pluginExists
        "tmux theme plugin '${cfg.theme.plugin}' not found in pkgs.tmuxPlugins"; [
          {
            plugin = pkgs.tmuxPlugins.${cfg.theme.plugin};
            extraConfig = cfg.theme.pluginConfig;
          }
        ]
      else [];
  in {
    programs.tmux = {
      enable = true;
      prefix = cfg.prefix;

      # Add theme plugin if specified
      plugins = themePlugins;

      extraConfig =
        builtins.readFile ./tmux.conf
        + "\n"
        + lib.concatMapStringsSep "\n" (name: cfg.extraConfigFragments.${name}) (builtins.attrNames cfg.extraConfigFragments)
        + ''

          # Rice-specific configuration
          ${cfg.theme.extraConfig}
        '';
    };
  };
}
