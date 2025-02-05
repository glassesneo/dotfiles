{ pkgs, ... }:
{
  home.packages = with pkgs; [
    bat
    btop
    devbox
    direnv
    duf
    fd
    fzf
    jq
    ripgrep
    sl
    unrar
    uv
    vim-startuptime
    xz
  ];
}
