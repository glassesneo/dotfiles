{
  delib,
  homeConfig,
  host,
  lib,
  ...
}:
delib.module {
  name = "programs.git.include";

  # Context-specific overlay on top of the base git module rather than a
  # separate git owner. Keeps work-only behavior independently toggleable.
  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = let
    workGitconfig = "${homeConfig.xdg.configHome}/git/work.gitconfig";
    iniadGitconfig = "${homeConfig.xdg.configHome}/git/iniad.gitconfig";
  in {
    home.activation.warnMissingGitIncludes = homeConfig.lib.dag.entryBefore ["writeBoundary"] ''
      if [[ ! -e ${lib.escapeShellArg workGitconfig} ]]; then
        warnEcho ${lib.escapeShellArg "warning: Git include file is missing: ${workGitconfig}; work-specific Git settings will not be applied."}
      fi

      if [[ ! -e ${lib.escapeShellArg iniadGitconfig} ]]; then
        warnEcho ${lib.escapeShellArg "warning: Git include file is missing: ${iniadGitconfig}; INIAD-specific Git settings will not be applied."}
      fi
    '';

    programs.git = {
      enable = true;
      includes = [
        {
          condition = "gitdir:${homeConfig.home.homeDirectory}/work/";
          path = workGitconfig;
        }
        {
          condition = "gitdir:${homeConfig.home.homeDirectory}/iniad/";
          path = iniadGitconfig;
        }
      ];
    };
  };
}
