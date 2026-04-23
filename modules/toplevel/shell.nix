{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "shell";

  options.shell.enable = delib.boolOption true;

  darwin.ifEnabled = {myconfig, ...}: {
    users.users.${myconfig.constants.username}.shell = pkgs.zsh;
    environment.shells = [
      pkgs.zsh
    ];
  };
}
