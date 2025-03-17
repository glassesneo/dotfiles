{pkgs, ...}:
pkgs.mkShellNoCC {
  name = "dotfiles";
  packages = with pkgs; [
    bash-language-server
    shfmt
    nil
    alejandra
    lua-language-server
    stylua
    taplo
    marksman
  ];
}
