{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "shell";

  options.shell.enable = delib.boolOption pkgs.stdenv.isDarwin;

  darwin.ifEnabled = {myconfig, ...}: {
    users.users.${myconfig.constants.username}.shell = pkgs.zsh;
    environment.shells = [
      pkgs.zsh
    ];
  };
}
