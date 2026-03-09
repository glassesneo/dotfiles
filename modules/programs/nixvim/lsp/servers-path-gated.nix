{
  delib,
  nixvimLsp,
  ...
}:
delib.module {
  name = "programs.nixvim.lsp.servers-path-gated";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nixvim.lsp.servers = {
    elmls = nixvimLsp.mkServer {
      root_markers = ["elm.json"];
    };
    hls = nixvimLsp.mkServer {
      haskell.formattingProvider = "fourmolu";
    };
    kotlin_language_server = nixvimLsp.mkServer {
      root_markers = [];
    };
    marksman = nixvimLsp.mkServer {
      filetypes = ["markdown"];
    };
    tinymist = nixvimLsp.mkServer {
      formatterMode = "typstyle";
    };
    zls =
      nixvimLsp.defaultServer
      // {
        config.zls = {
          enable_snippets = true;
          enable_ast_check_diagnostics = true;
          enable_autofix = true;
          enable_import_embedfile_argument_completions = true;
          warn_style = true;
          enable_semantic_tokens = true;
          enable_inlay_hints = true;
          inlay_hints_show_builtin = true;
          inlay_hints_hide_redundant_param_names = true;
          inlay_hints_hide_redundant_param_names_last_token = true;
          operator_completions = true;
          include_at_in_builtins = true;
        };
      };
    basedpyright = nixvimLsp.defaultServer;
    biome = nixvimLsp.defaultServer;
    gopls = nixvimLsp.defaultServer;
    nim_langserver = nixvimLsp.defaultServer;
    nushell = nixvimLsp.defaultServer;
    prismals = nixvimLsp.defaultServer;
    taplo = nixvimLsp.defaultServer;
  };
}
