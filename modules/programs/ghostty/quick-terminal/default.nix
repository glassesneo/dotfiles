{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.ghostty.quick-terminal";

  options = with delib;
    moduleOptions ({parent, ...}: {
      # Child feature under the Ghostty namespace. This stays separate because
      # quick-terminal behavior is useful to toggle independently of Ghostty itself.
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
      lib.replaceStrings ["@color@"] [cfg.background] (lib.readFile ./quick-terminal-check.sh)
    );
  };
}
