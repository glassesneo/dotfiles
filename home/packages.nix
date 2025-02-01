{ pkgs, ... }:
{
  home.packages = with pkgs; [
    bat
    btop
    devbox
    direnv
    duf
    fd
    jq
    ripgrep
    sl
    unrar
    uv
    vim-startuptime
    xz
  ];
}
