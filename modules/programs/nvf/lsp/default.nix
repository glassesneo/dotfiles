{delib, ...}:
delib.module {
  name = "programs.nvf.lsp";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf = {
      settings.vim.lsp = {
        enable = true;
        inlayHints.enable = true;
        lspconfig.enable = true;
        # Conform owns format-on-save and consults this global toggle; its
        # availability callback keeps buffers without a writer as a no-op.
        formatOnSave = true;
      };
    };
  };
}
