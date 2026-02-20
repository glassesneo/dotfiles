{
  delib,
  homeConfig,
  lib,
  ...
}:
delib.module {
  name = "programs.zsh";

  options.programs.zsh = with delib; {
    enable = boolOption true;
  };

  home.ifEnabled = {
    cfg,
    myconfig,
    ...
  }: {
    programs.zsh = let
      ghqRoot = homeConfig.programs.git.settings.ghq.root;
    in {
      enable = cfg.enable;
      enableCompletion = true;
      autosuggestion.enable = true;
      syntaxHighlighting.enable = true;
      cdpath = [
        "${ghqRoot}/github.com"
      ];
      dirHashes = {
        github = "${ghqRoot}/github.com";
      };
      dotDir = "${homeConfig.xdg.configHome}/zsh";
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
