{delib, ...}:
delib.module {
  name = "programs.nvf.lsp";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf = {
      settings.vim.lsp = {
        enable = true;
        formatOnSave = true;
      };
    };
  };
}
