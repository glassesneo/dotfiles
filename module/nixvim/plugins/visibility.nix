{pkgs, ...}: {
  plugins = {
    marks = {
      enable = true;
      defaultMappings = false;
    };
    smear-cursor = {
      enable = true;
    };
    treesitter-context = {
      # enable = true;
      settings = {
        separator = "―";
      };
    };
  };
  extraPlugins = with pkgs.vimPlugins; [
    hlchunk-nvim
    quick-scope
    nvim_context_vt
  ];
  extraConfigLua = ''
    require('nvim_context_vt').setup({
      prefix = "",
    })
  '';
}
