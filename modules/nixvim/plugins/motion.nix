{pkgs, ...}: {
  plugins = {
  };
  extraPlugins = with pkgs.vimPlugins; [
    clever-f-vim
    vim-asterisk
  ];
}
