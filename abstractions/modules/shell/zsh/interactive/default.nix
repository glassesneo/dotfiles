{
  delib,
  lib,
  mylib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "zsh.interactive";

  options = with delib; {
    enable = boolOption true;
    package = packageOption myconfig.zsh.package;
  };

  hjem.always.options.zsh.zshrc = mylib.fragments.option;

  hjem.ifEnabled = {config, ...}: let
    dotDir = "${config.xdg.config.directory}/zsh";
  in {
    zsh.zshenv.zdotdir.text = ''
      ZDOTDIR="${dotDir}"
    '';

    files.".zshrc" = {
      relativeTo = dotDir;
      exclusive = true;
      text = lib.concatStringsSep "\n" [
        (builtins.readFile ./rc.zsh)
        (mylib.fragments.render config.zsh.zshrc)
      ];
    };
  };
})
