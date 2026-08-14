{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "system.shell";

  options.system.shell.enable = delib.boolOption true;

  darwin.ifEnabled = {myconfig, ...}: {
    users.users.${myconfig.constants.username}.shell = pkgs.zsh;
    environment.shells = [
      pkgs.zsh
    ];
  };

  nixos.ifEnabled = {myconfig, ...}: {
    users.defaultUserShell = pkgs.zsh;
    users.users.${myconfig.constants.username}.shell = pkgs.zsh;
    programs.zsh.enable = true;
  };
}
