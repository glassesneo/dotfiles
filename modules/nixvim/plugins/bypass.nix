{pkgs, ...}: {
  extraPlugins = with pkgs.vimPlugins; [
    mkdir-nvim
    numb-nvim
    vim-eunuch
  ];
}
