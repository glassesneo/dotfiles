{
  delib,
  homeConfig,
  ...
}:
delib.module {
  name = "programs.git.work";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.git = {
      enable = true;
      includes = [
        {
          condition = "gitdir:${homeConfig.home.homeDirectory}/work/";
          path = "${homeConfig.xdg.configHome}/git/work.gitconfig";
        }
      ];
    };
  };
}
