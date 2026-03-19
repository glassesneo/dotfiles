{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.ghostty.quick-terminal";

  options = with delib;
    moduleOptions ({parent, ...}: {
      enable = boolOption parent.enable;
      background = strOption "#20263a";
    });

  home.ifEnabled = {cfg, ...}: {
    programs.ghostty = {
      settings = {
        quick-terminal-position = "center";
        quick-terminal-size = "55%";
        quick-terminal-autohide = true;
      };
    };
    programs.zsh.initContent = lib.mkOrder 1200 (
      builtins.readFile (
        pkgs.replaceVars ./quick-terminal-check.sh {color = cfg.background;}
      )
    );
  };
}
