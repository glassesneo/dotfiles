{ pkgs, ... }:
{
  home.packages = with pkgs; [
    bat
    btop
    coreutils
    devbox
    duf
    fastfetch
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
