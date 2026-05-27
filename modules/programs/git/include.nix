{
  delib,
  homeConfig,
  host,
  ...
}:
delib.module {
  name = "programs.git.include";

  # Context-specific overlay on top of the base git module rather than a
  # separate git owner. Keeps work-only behavior independently toggleable.
  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = {
    programs.git = {
      enable = true;
      includes = [
        {
          condition = "gitdir:${homeConfig.home.homeDirectory}/work/";
          path = "${homeConfig.xdg.configHome}/git/work.gitconfig";
        }
        {
          condition = "gitdir:${homeConfig.home.homeDirectory}/iniad/";
          path = "${homeConfig.xdg.configHome}/git/iniad.gitconfig";
        }
      ];
    };
  };
}
