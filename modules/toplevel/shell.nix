{
  delib,
  homeConfig,
  lib,
  ...
}:
delib.module {
  name = "shell";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.shellAliases = {
      bd = "cd ..";
      projectroot = "${lib.getExe homeConfig.programs.git.package} rev-parse --show-toplevel";
    };
  };
}
