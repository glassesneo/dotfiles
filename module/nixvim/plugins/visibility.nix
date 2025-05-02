{pkgs, ...}: {
  plugins = {
    marks = {
      enable = true;
      defaultMappings = false;
    };
    smear-cursor = {
      enable = true;
      settings = {
        distance_stop_animating = 3;
        smear_to_cmd = false;
      };
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
