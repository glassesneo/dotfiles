{delib, ...}:
delib.module {
  name = "programs.nvf.languages.zig";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim.languages.zig = {
    enable = true;
    treesitter.enable = true;
    lsp.enable = false;
  };
}
