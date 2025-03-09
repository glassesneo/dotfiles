{pkgs, ...}: {
  environment = {
    shells = [pkgs.zsh];
    shellAliases = {
      bd = "cd ..";
    };
    extraInit = ''
      eval "$(/opt/homebrew/bin/brew shellenv)"
      if [[ $- == *i* ]]; then
        # execute nushell if running interactively
        exec nu
      fi
    '';
  };
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    # autosuggestion.enable = true;
    # syntaxHighlighting.enable = true;
    # autocd = true;
    # history = {
    #   extended = true;
    #   size = 10000;
    #   path = "${config.xdg.stateHome}/zsh/history";
    # };
  };
}
