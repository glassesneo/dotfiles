{pkgs, ...}: {
  extraPlugins = with pkgs.vimPlugins; [
    mkdir-nvim
    numb-nvim
    vim-eunuch
  ];
  extraConfigLua = ''
    require("numb").setup()
  '';
}
