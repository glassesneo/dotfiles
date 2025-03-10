{pkgs, ...}:
pkgs.mkShellNoCC {
  name = "dotfiles";
  packages = with pkgs; [
    efm-langserver
    bash-language-server
    shfmt
    tree-sitter
    deno
    gcc
    nil
    alejandra
    lua-language-server
    stylua
    taplo
    marksman
  ];
}
