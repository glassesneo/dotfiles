{
  delib,
  homeConfig,
  host,
  ...
}:
delib.module {
  name = "programs.zsh";

  options = delib.singleEnableOption host.devCoreFeatured;

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
        "hist_ignore_all_dups"
        "hist_save_no_dups"
        "hist_expire_dups_first"
        "noclobber"
        "append_create"
      ];
      history = {
        extended = true;
        size = 10000;
        path = "${homeConfig.xdg.stateHome}/zsh/history";
      };
    };
  };
}
