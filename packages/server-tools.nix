{pkgs}:
pkgs.buildEnv {
  name = "server-tools";
  paths = with pkgs; [
    zsh
    git
    gh
    tmux
    ripgrep
    fd
    fzf
    zoxide
    jq
    gomi
  ];
  pathsToLink = ["/bin"];
}
