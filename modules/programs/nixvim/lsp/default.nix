{
  delib,
  homeConfig,
  inputs,
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
    # activate = false: PATH-based servers are disabled by default and
    #   enabled conditionally by guarded_enable in extra.lua when executable is available.
    # activate = true: Store-pinned servers (via explicit cmd) are always available.
    defaultServer = {
      enable = true;
      package = null;
      activate = false;
    };
    serverLevelKeys = ["activate" "package"];
    mkServer = args: let
      serverAttrs = lib.filterAttrs (n: _: builtins.elem n serverLevelKeys) args;
      configAttrs = removeAttrs args serverLevelKeys;
    in
      defaultServer // serverAttrs // lib.optionalAttrs (configAttrs != {}) {config = configAttrs;};
    inherit (homeConfig.home) stateVersion;
    _pkgs = "import ${pkgs.path} {}";
  in {
    lsp = {
      inlayHints.enable = true;
      servers = {
        # --- Servers with custom config ---

        bashls = mkServer {
          cmd = ["${lib.getExe pkgs.bash-language-server}"];
          activate = true; # Store-pinned, always available
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
        # Enable the built-in Copilot LSP server entry.
        # Runtime behavior (root_dir filters, keymaps, inline completion) lives in extra.lua.
        copilot.enable = true;
        nixd = mkServer {
          package = pkgs.nixd;
          activate = true;
          settings.nixd = {
            formatting.command = ["${pkgs.alejandra}/bin/alejandra"];
            nixpkgs.expr = _pkgs;
            options.home-manager.expr = ''
              let
                hmFlake = builtins.getFlake "${inputs.home-manager.outPath}";
                nixvimFlake = builtins.getFlake "${inputs.nixvim.outPath}";
                pkgs = ${_pkgs};
              in
                (hmFlake.lib.homeManagerConfiguration {
                  inherit pkgs;
                  modules = [
                    nixvimFlake.homeModules.nixvim
                    {
                      home = {
                        username = "neo";
                        homeDirectory = "/Users/neo";
                        stateVersion = "${stateVersion}";
                      };
                    }
                  ];
                }).options
            '';
          };
        };
        tinymist = mkServer {
          formatterMode = "typstyle";
        };
        zls =
          defaultServer
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

        # --- Servers with default config (enable + PATH-based binary) ---

        basedpyright = defaultServer;
        biome = defaultServer;
        gopls = defaultServer;
        nickel_ls = mkServer {
          package = pkgs.nls;
          activate = true;
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
          "nixd"
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
    extraPackages = [pkgs.efm-langserver pkgs.nls pkgs.nickel pkgs.copilot-language-server];
  };
}
