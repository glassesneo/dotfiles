{delib, ...}:
delib.module {
  name = "programs.nvf.languages.typst";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim.languages.typst = {
    enable = true;
    treesitter.enable = true;
    lsp.enable = false;
    format.enable = false;
    extensions.typst-preview-nvim.enable = false;
    extensions.typst-concealer.enable = false;
  };
}
