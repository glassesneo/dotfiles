{pkgs, ...}: {
  plugins = {
    marks = {
      enable = true;
      defaultMappings = false;
    };
  };
  extraPlugins = with pkgs.vimPlugins; [
    hlchunk-nvim
    quick-scope
    nvim_context_vt
  ];
}
