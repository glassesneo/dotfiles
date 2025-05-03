{
  plugins.lsp = {
    enable = true;
    inlayHints = true;
    capabilities = ''
      local status, ddc_lsp = pcall(require, "ddc_source_lsp")
      if status then
        capabilities = ddc_lsp.make_client_capabilities()
      end
    '';
    servers = {
      bashls = {
        enable = true;
        package = null;
      };
      basedpyright = {
        enable = true;
        package = null;
      };
      denols = {
        enable = true;
        package = null;
        extraOptions = {
          single_file_support = true;
          init_options = {
            lint = true;
            unstable = true;
            suggest = {
              imports = {
                hosts = {
                  "https://deno.land" = true;
                  "https://cdn.nest.land" = true;
                  "https://crux.land" = true;
                };
              };
            };
          };
        };
        settings = {
          rootMarkers = ["deno.json" "deno.jsonc"];
          deno = {
            inlayHints = {
              parameterNames = {
                enabled = "all";
                suppressWhenArgumentMatchesName = true;
              };
              parameterTypes.enabled = true;
              variableTypes = {
                enabled = true;
                suppressWhenTypeMatchesName = true;
              };
              propertyDeclarationTypes.enabled = true;
              functionLikeReturnTypes.enabled = true;
              enumMemberValues.enabled = true;
            };
          };
        };
      };
      efm = {
        enable = true;
        settings = {
          rootMarkers = [
            ".git/"
          ];
        };
      };
      elmls = {
        enable = true;
        settings = {
          rootMarkers = [
            "elm.json"
          ];
        };
      };
      hls = {
        enable = true;
        package = null;
        installGhc = false;
        settings.haskell = {
          formattingProvider = "fourmolu";
        };
      };
      lua_ls = {
        enable = true;
        package = null;
        settings = {
          runtime = {
            version = "LuaJIT";
            pathStrict = true;
          };
          workspace = {
            library = [
              {
                __raw = ''vim.fn.expand "$VIMRUNTIME"'';
              }
              {
                __raw = ''vim.fn.expand "$VIMRUNTIME/lua/vim/lsp"'';
              }
              "\${3rd}/luv/library"
            ];
            checkThirdParty = false;
          };
          hint = {
            enable = true;
            arrayIndex = "Enable";
            setType = true;
          };
        };
      };
      marksman = {
        enable = true;
        package = null;
        filetypes = ["markdown"];
      };
      nil_ls = {
        enable = true;
        package = null;
        settings = {
          nix = {
            flake = {
              autArchive = true;
            };
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
      pylyzer = {
        # enable = true;
        package = null;
        settings.python = {
          inlayHints = true;
        };
      };
      tailwindcss = {
        # enable = true;
        package = null;
      };
      taplo = {
        enable = true;
        package = null;
      };
      tinymist = {
        enable = true;
        package = null;
        settings = {
          formatterMode = "typstyle";
        };
      };
      zls = {
        enable = true;
        package = null;
        extraOptions = {
          single_file_support = false;
        };
        settings.zls = {
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
}
