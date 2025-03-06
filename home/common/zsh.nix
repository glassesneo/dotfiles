{
  config,
  pkgs,
  lib,
  ...
}: let
  extraZshrc = lib.mkMerge [
    (lib.mkIf (lib.strings.hasSuffix "-darwin" pkgs.system) ''
      eval "$(/opt/homebrew/bin/brew shellenv)"
      if [[ $- == *i* ]]; then
        # execute nushell if running interactively
        exec nu
      fi
    '')
  ];
in {
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;
    autocd = true;
    shellAliases = {
      bd = "cd ..";
    };
    initExtra = extraZshrc;
    history = {
      extended = true;
      size = 10000;
      path = "${config.xdg.stateHome}/zsh/history";
    };
  };
}
