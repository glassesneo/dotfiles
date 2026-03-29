{
  delib,
  # homeConfig,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "shell";

  options.shell = with delib; {
    enable = boolOption true;
    defaultShell = lib.mkOption {
      type = lib.types.enum ["zsh"];
      default = "zsh";
      description = "Default shell to use";
    };
  };

  home.ifEnabled = {
    home.shellAliases = {
      # projectroot = "${lib.getExe homeConfig.programs.git.package} rev-parse --show-toplevel";
    };
  };

  darwin.ifEnabled = {myconfig, ...}: {
    users.users.${myconfig.constants.username}.shell = pkgs.zsh;
    environment.shells = [
      pkgs.zsh
    ];
  };
}
