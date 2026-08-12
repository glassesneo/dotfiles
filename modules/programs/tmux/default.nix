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
  };

  myconfig.always = {cfg, ...}: {
    args.shared.tmux.prefix = cfg.prefix;
  };

  home.ifEnabled = {
    cfg,
    myconfig,
    ...
  }: let
    colorscheme = myconfig.args.shared.colorscheme;
    colors = colorscheme.palette;
    isCatppuccin = colorscheme.name == "catppuccin";
    accent =
      if colorscheme.name == "everforest"
      then colors.base0B
      else colors.base08;
    currentWindowForeground =
      if colorscheme.name == "everforest"
      then colors.base05
      else colors.base07;

    themePlugins = lib.optionals isCatppuccin [
      {
        plugin = pkgs.tmuxPlugins.catppuccin;
        extraConfig = ''
          set -g @catppuccin_flavor '${colorscheme.variant}'
          set -g @catppuccin_window_status_style 'basic'
          set -g @catppuccin_status_background 'none'
        '';
      }
    ];

    catppuccinConfig = ''
      set -g status-right-length 100
      set -g status-left-length 100
      set -g status-left ""
      set -g status-right ""
      set -g pane-border-style "fg=${colors.base03}"
      set -g pane-active-border-style "fg=${colors.base07}"
      set -g message-style "fg=${colors.base05},bg=default"
      set -g message-command-style "fg=${colors.base07},bg=default"
      set -g display-panes-colour "${colors.base04}"
      set -g display-panes-active-colour "${colors.base07}"
      set -g popup-style "bg=default,fg=${colors.base05}"
      set -g popup-border-style "fg=${colors.base07}"
    '';

    paletteConfig = ''
      set -g status-style 'bg=default,fg=${colors.base05}'
      set -g status-left '#[fg=${accent},bold][#S] '
      set -g status-left-length 20
      set -g status-right ""
      set -g window-status-format '#[fg=${colors.base04}] #I:#W '
      set -g window-status-current-format '#[fg=${currentWindowForeground},bold,underscore] #I:#W '
      set -g window-status-separator ""
      set -g pane-border-style 'fg=${colors.base02}'
      set -g pane-active-border-style 'fg=${accent}'
      set -g message-style 'fg=${colors.base05},bg=default'
      set -g message-command-style 'fg=${currentWindowForeground},bg=default'
      set -g display-panes-colour '${colors.base04}'
      set -g display-panes-active-colour '${accent}'
      set -g popup-style 'bg=default,fg=${colors.base05}'
      set -g popup-border-style 'fg=${accent}'
    '';

    ownerThemeConfig =
      if isCatppuccin
      then catppuccinConfig
      else paletteConfig;
    localOverrides = lib.concatMapStringsSep "\n" (name: cfg.extraConfigFragments.${name}) (builtins.attrNames cfg.extraConfigFragments);
  in {
    programs.tmux = {
      enable = true;
      prefix = cfg.prefix;
      plugins = themePlugins;

      extraConfig =
        builtins.readFile ./tmux.conf
        + "\n"
        + ownerThemeConfig
        + "\n"
        + localOverrides;
    };
  };
}
