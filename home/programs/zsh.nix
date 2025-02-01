{ config, ... }:
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
    envExtra = ''
      PATH=/nix/var/nix/profiles/default/bin:~/.nix-profile/bin:$PATH
    '';
    history = {
      extended = true;
      size = 10000;
      path = "${config.xdg.stateHome}/zsh/history";
    };
  };
}
