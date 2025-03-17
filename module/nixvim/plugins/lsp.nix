{
  plugins = {
    lsp = {
      enable = true;
      inlayHints = true;
      capabilities = ''
        local status, ddc_lsp = pcall(require, "ddc_source_lsp")
        if status then
          capabilities = ddc_lsp.make_client_capabilities()
        end
      '';
      servers = {
        efm = {
          enable = true;
          extraOptions = {
            init_options = {
              documentFormatting = true;
              documentRangeFormatting = true;
            };
          };
          filetypes = ["nix" "lua"];
          settings = {
            rootMarkers = [
              ".git/"
            ];
            languages = {
              nix = [
                {
                  formatCommand = "alejandra -";
                  formatStdin = true;
                }
              ];
              lua = [
                {
                  formatCommand = "stylua --indent-type Spaces --indent-width 2 -";
                  formatStdin = true;
                }
              ];
            };
          };
        };
        bashls = {
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
          rootDir.__raw = "require('lspconfig').util.root_pattern('deno.json', 'deno.jsonc')";
          settings = {
            # deno = {
            # inlayHints = {
            # parameterNames = {
            # enabled = "all";
            # suppressWhenArgumentMatchesName = true;
            # };
            # parameterTypes.enabled = true;
            # variableTypes = {
            # enabled = true;
            # suppressWhenTypeMatchesName = true;
            # };
            # propertyDeclarationTypes.enabled = true;
            # functionLikeReturnTypes.enabled = true;
            # enumMemberValues.enabled = true;
            # };
            # };
          };
        };
        lua_ls = {
          enable = true;
          package = null;
          settings = {
            runtime = {
              version = "LuaJIT";
              pathStrict = true;
              path = ["?.lua" "?/init.lua"];
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
              # enable = true;
              arrayIndex = "Enable";
              setType = true;
            };
          };
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
        taplo = {
          package = null;
          enable = true;
        };
        zls = {
          enable = true;
          # autostart = false;
          package = null;
          extraOptions = {
            single_file_support = false;
          };
          settings = {
            zls = {
              enable_snippets = true;
              enable_ast_check_diagnostics = true;
              enable_autofix = true;
              enable_import_embedfile_argument_completions = true;
              warn_style = true;
              enable_semantic_tokens = true;
              # enable_inlay_hints = true;
              # inlay_hints_show_builtin = true;
              # inlay_hints_hide_redundant_param_names = true;
              # inlay_hints_hide_redundant_param_names_last_token = true;
              operator_completions = true;
              include_at_in_builtins = true;
            };
          };
        };
      };
    };
    lsp-format = {
      enable = true;
      lspServersToEnable = [
        "efm"
        "denols"
        "taplo"
        "zls"
      ];
    };
  };
}
