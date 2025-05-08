{pkgs, ...}:
pkgs.mkShellNoCC {
  name = "dotfiles";
  packages = with pkgs; [
    bash-language-server
    shfmt
    alejandra
    lua-language-server
    stylua
    taplo
    marksman
  ];
}
