{pkgs, ...}:
pkgs.mkShellNoCC {
  name = "dotfiles";
  packages = with pkgs; [
    bash-language-server
    shfmt
    lua-language-server
    stylua
    taplo
    marksman
  ];
}
