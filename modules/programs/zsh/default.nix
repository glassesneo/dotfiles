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
      cdpath = [
        "${ghqRoot}/github.com"
      ];
      dirHashes = {
        github = "${ghqRoot}/github.com";
      };
      dotDir = "${homeConfig.xdg.configHome}/zsh";
      setOptions = [
        "HIST_IGNORE_ALL_DUPS"
        "HIST_SAVE_NO_DUPS"
        "HIST_EXPIRE_DUPS_FIRST"
      ];
      history = {
        extended = true;
        size = 10000;
        path = "${homeConfig.xdg.stateHome}/zsh/history";
      };
    };
  };
}
