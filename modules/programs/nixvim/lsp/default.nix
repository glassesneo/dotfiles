{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.lsp";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = let
    # Shared defaults for all LSP servers managed by Nix.
    # All servers use package = null (PATH-based binary resolution).
    # Servers needing custom config override via `mkServer config`.
    defaultServer = {enable = true; package = null;};
    mkServer = config: defaultServer // {inherit config;};
  in {
    lsp = {
      inlayHints.enable = true;
      servers = {
        # --- Servers with custom config ---

        bashls = mkServer {
          cmd = ["${lib.getExe pkgs.bash-language-server}"];
        };
        elmls = mkServer {
          root_markers = ["elm.json"];
        };
        hls = mkServer {
          haskell.formattingProvider = "fourmolu";
        };
        kotlin_language_server = mkServer {
          root_markers = [];
        };
        marksman = mkServer {
          filetypes = ["markdown"];
        };
        nixd = mkServer {
          cmd = ["${lib.getExe pkgs.nixd}"];
          nixpkgs.expr = "import <nixpkgs> { }";
          formatting.command = ["alejandra"];
        };
        tinymist = mkServer {
          formatterMode = "typstyle";
        };
        zls = defaultServer // {
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

        # --- Servers with default config (enable + PATH-based binary) ---

        basedpyright = defaultServer;
        biome = defaultServer;
        gopls = defaultServer;
        nickel_ls = mkServer {
          cmd = ["${lib.getExe pkgs.nls}"];
        };
        nim_langserver = defaultServer;
        nushell = defaultServer;
        prismals = defaultServer;
        taplo = defaultServer;
      };
    };
    plugins = {
      lspconfig.enable = true;
      lsp-format = {
        enable = true;
        lspServersToEnable = [
          "efm"
          "denols"
          "hls"
          "moonbit-lsp"
          "taplo"
          "zls"
        ];
      };
    };
    # Imperative LSP concerns live in extra.lua:
    # - Servers not in nixvim schema (emmylua_ls, sourcekit, denols, ts_ls, efm, moonbit-lsp)
    # - vim.lsp.config overrides requiring Lua-only APIs (workspace library paths, init_options)
    # - efm language/formatter definitions
    extraConfigLuaPost = builtins.readFile ./extra.lua;
    extraPackages = [pkgs.efm-langserver pkgs.nls pkgs.nickel];
  };
}
