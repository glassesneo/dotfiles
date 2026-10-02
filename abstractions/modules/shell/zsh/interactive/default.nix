{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "zsh.interactive";

  options = with delib; {
    enable = boolOption true;
    package = packageOption myconfig.zsh.package;
  };

  hjem.ifEnabled = {config, ...}: let
    dotDir = "${config.xdg.config.directory}/zsh";
    underDotDir = attrs: attrs // {relativeTo = dotDir;};
  in {
    files = {
      ".zshenv".text = ''
        ZDOTDIR="${dotDir}"
      '';
      ".zshrc" = underDotDir {
        source = ./rc.zsh;
      };
    };
  };
})
