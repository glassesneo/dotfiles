{delib, ...}:
delib.module {
  name = "programs.nvf.lsp";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim = {
    additionalRuntimePaths = [./runtime];
    luaConfigRC.nvf-lsp-defaults = "require('nvf.lsp_defaults').setup()";
    lsp = {
      enable = true;
      inlayHints.enable = true;
      lspconfig.enable = true;
      # Conform owns format-on-save and consults this global toggle; its
      # availability callback keeps buffers without a writer as a no-op.
      formatOnSave = true;
      # Insurance if vendoredKeymaps.enable does not null these defaults.
      # Restoring any <Space>l* map reintroduces timeoutlen wait on <Space>l.
      mappings = {
        goToDeclaration = null;
        goToDefinition = null;
        goToType = null;
        listImplementations = null;
        listReferences = null;
        nextDiagnostic = null;
        previousDiagnostic = null;
        openDiagnosticFloat = null;
        documentHighlight = null;
        listDocumentSymbols = null;
        addWorkspaceFolder = null;
        removeWorkspaceFolder = null;
        listWorkspaceFolders = null;
        listWorkspaceSymbols = null;
        hover = null;
        signatureHelp = null;
        renameSymbol = null;
        codeAction = null;
        format = null;
        toggleFormatOnSave = null;
      };
    };
  };
}
