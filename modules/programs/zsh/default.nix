{
  delib,
  homeConfig,
  host,
  ...
}:
delib.module {
  name = "programs.zsh";

  options = delib.singleEnableOption host.guiShellFeatured;

  home.ifEnabled = {
    programs.zsh = let
      ghqRoot = homeConfig.programs.git.settings.ghq.root;
    in {
      enable = true;
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
