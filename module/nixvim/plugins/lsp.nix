{
  plugins = {
    lsp = {
      enable = true;
      inlayHints = true;
      servers = {
        efm = {
          enable = true;
          extraOptions = {
            init_options = {
              documentFormatting = true;
              documentRangeFormatting = true;
            };
          };
          filetypes = ["nix"];
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
        };
        denols = {
          enable = true;
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
        lua_ls = {
          enable = true;
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
              enable = true;
            };
          };
        };
        nil_ls = {
          enable = true;
          settings = {
            nix = {
              flake = {
                autArchive = true;
              };
            };
          };
        };
        taplo = {
          enable = true;
        };
      };
    };
    lsp-format = {
      enable = true;
      lspServersToEnable = [
        "efm"
        "denols"
        "taplo"
      ];
    };
  };
}
