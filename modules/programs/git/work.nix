{
  delib,
  homeConfig,
  ...
}:
delib.module {
  name = "programs.git.work";

  # Context-specific overlay on top of the base git module rather than a
  # separate git owner. Keeps work-only behavior independently toggleable.
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
