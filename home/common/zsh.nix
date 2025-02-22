{
  config,
  pkgs,
  lib,
  ...
}: {
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;
    autocd = true;
    initExtra =
      lib.mkIf (lib.strings.hasSuffix "-darwin" pkgs.system)
      ''
        eval "$(/opt/homebrew/bin/brew shellenv)"
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
