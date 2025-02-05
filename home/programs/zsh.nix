{ config, ... }:
let
  userName = builtins.getEnv "USER";
in
{
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;
    autocd = true;
    shellAliases = {
      ls = "eza";
      bd = "cd ..";
      tree = "eza --tree";
    };
    shellGlobalAliases = {
      projectroot = "`git rev-parse --show-toplevel`";
    };
    initExtra = ''
      if [[ $- == *i* ]]; then
        # execute nushell if running interactively
        exec nu
      fi
    '';
    history = {
      extended = true;
      size = 10000;
      path = "${config.xdg.stateHome}/zsh/history";
    };
  };
}
