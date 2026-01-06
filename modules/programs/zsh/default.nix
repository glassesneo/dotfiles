{
  delib,
  homeConfig,
  ...
}:
delib.module {
  name = "programs.zsh";

  options.programs.zsh = with delib; {
    enable = boolOption true;
  };

  home.ifEnabled = {cfg, ...}: {
    programs.zsh = {
      enable = cfg.enable;
      enableCompletion = true;
      autosuggestion.enable = true;
      syntaxHighlighting.enable = true;
      autocd = true;
      dotDir = "${homeConfig.xdg.configHome}/zsh";
      profileExtra = builtins.readFile ./zellij.zsh;
      history = {
        extended = true;
        size = 10000;
        path = "${homeConfig.xdg.stateHome}/zsh/history";
      };
      zsh-abbr = {
        enable = true;
        abbreviations = {
          g = "git";
        };
      };
    };
  };
}
