{ pkgs, ... }:
{
  home.packages = with pkgs; [
    bat
    btop
    coreutils
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
