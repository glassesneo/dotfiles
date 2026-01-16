{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.lsp";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    lsp = {
      inlayHints.enable = true;
      servers = {
        bashls = {
          enable = true;
          package = null;
          config = {
            cmd = ["${lib.getExe pkgs.bash-language-server}"];
          };
        };
        basedpyright = {
          enable = true;
          package = null;
        };
        biome = {
          enable = true;
          package = null;
        };
        elmls = {
          enable = true;
          package = null;
          config = {
            root_markers = [
              "elm.json"
            ];
          };
        };
        gopls = {
          enable = true;
          package = null;
        };
        hls = {
          enable = true;
          package = null;
          config = {
            haskell = {
              formattingProvider = "fourmolu";
            };
          };
        };
        kotlin_language_server = {
          enable = true;
          package = null;
          config = {
            root_markers = [];
          };
        };
        marksman = {
          enable = true;
          package = null;
          config = {
            filetypes = ["markdown"];
          };
        };
        nickel_ls = {
          enable = true;
          package = null;
        };
        nil_ls = {
          # enable = true;
          package = null;
          config = {
            cmd = ["${lib.getExe pkgs.nil}"];
            nix = {
              flake = {
                autArchive = true;
              };
            };
          };
        };
        nixd = {
          enable = true;
          package = null;
          config = {
            cmd = ["${lib.getExe pkgs.nixd}"];
            nixpkgs.expr = "import <nixpkgs> { }";
            formatting = {
              command = ["alejandra"];
            };
          };
        };
        nim_langserver = {
          enable = true;
          package = null;
        };
        nushell = {
          enable = true;
          package = null;
        };
        prismals = {
          enable = true;
          package = null;
        };
        taplo = {
          enable = true;
          package = null;
        };
        tinymist = {
          enable = true;
          package = null;
          config = {
            formatterMode = "typstyle";
          };
        };
        zls = {
          enable = true;
          package = null;
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
      };
    };
    plugins = {
      lspconfig = {
        enable = true;
      };
      lsp-format = {
        enable = true;
        lspServersToEnable = [
          "efm"
          "denols"
          "hls"
          "taplo"
          "zls"
        ];
      };
    };
    extraConfigLuaPost = builtins.readFile ./extra.lua;
    extraPackages = [pkgs.efm-langserver];
  };
}
