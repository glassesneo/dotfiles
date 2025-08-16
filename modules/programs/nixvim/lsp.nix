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
          settings = {
            cmd = ["${lib.getExe pkgs.bash-language-server}"];
          };
        };
        basedpyright = {
          enable = true;
          package = null;
        };
        elmls = {
          enable = true;
          package = null;
          settings = {
            rootMarkers = [
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
          settings.haskell = {
            formattingProvider = "fourmolu";
          };
        };
        kotlin_language_server = {
          enable = true;
          package = null;
          settings = {
            rootMarkers = [];
          };
        };
        marksman = {
          enable = true;
          package = null;
          settings = {
            filetypes = ["markdown"];
          };
        };
        nickel_ls = {
          # enable = true;
          package = null;
          settings = {
            cmd = ["${lib.getExe pkgs.nls}"];
          };
        };
        nil_ls = {
          # enable = true;
          package = null;
          settings = {
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
          settings = {
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
    extraConfigLuaPost = ''
      vim.lsp.enable({ "lua_ls" })
      vim.lsp.enable({ "sourcekit" })
      vim.lsp.enable({ "denols" })
      vim.lsp.enable({ "kotlin_lsp" })
      vim.lsp.enable({ "efm" })


      local library_paths = {
        vim.env.VIMRUNTIME.. "/lua",
        vim.env.VIMRUNTIME.. "/lua/vim/_meta", -- for EmmyLua
        vim.fn.stdpath('config').. "/lua",
      }

      local unique_library_paths = {}
      local seen_paths = {}
      for _, path in ipairs(library_paths) do
        if path and not seen_paths[path] then
          table.insert(unique_library_paths, path)
          seen_paths[path] = true
        end
      end

      vim.lsp.config.lua_ls = {
        settings = {
          Lua = {
            runtime = {
              version = "LuaJIT",
              pathStrict = true,
            },
            diagnostics = {
              globals = {"vim"},
            },
            workspace = {
              library = unique_library_paths,
              checkThirdParty = false,
              ignoreDir = {
                ".*",
              },
            },
            telemetry = { enable = false },
            hint = {
              enable = true,
              arrayIndex = "Enable",
              setType = true,
            },

          },
        },
      }

      -- vim.lsp.config.kotlin_lsp = {
      -- single_file_support = true,
      -- settings = {
      -- rootMarkers = {},
      -- }
      -- }

      vim.lsp.config.sourcekit = {
        single_file_support = true,
      }

      vim.lsp.config.denols = {
        single_file_support = true,
        init_options = {
          lint = true,
          unstable = true,
          suggest = {
            imports = {
              hosts = {
                ["https://deno.land"] = true,
                ["https://cdn.nest.land"] = true,
                ["https://crux.land"] = true,
              },
            },
          },
        },
        settings = {
          rootMarkers = {"deno.json", "deno.jsonc"},
          deno = {
            inlayHints = {
              parameterNames = {
                enabled = "all",
                suppressWhenArgumentMatchesName = true,
              },
              parameterTypes = {
                enabled = true,
              },
              variableTypes = {
                enabled = true,
                suppressWhenTypeMatchesName = true,
              },
              propertyDeclarationTypes = {
                enabled = true,
              },
              functionLikeReturnTypes = {
                enabled = true,
              },
              enumMemberValues = {
                enabled = true,
              },
            },
          },
        },
      }
      vim.lsp.config.efm = {
        init_options = {
          documentFormatting = true,
          documentRangeFormatting = true,
        },
        filetypes = {"elm", "go", "html", "nim", "nix", "python", "swift", "lua", "typst"},
        settings = {
          root_markers = {
            ".git/"
          },
          languages = {
            elm = {
              {
                formatCommand = "elm-format --stdin",
                formatStdin = true,
              }
            },
            go = {
              {
                formatCommand = "goimports",
                formatStdin = true,
              },
              {
                formatCommand = "gofmt",
                formatStdin = true,
              },
            },
            kotlin = {
              {
                formatCommand = "ktlint --stdin --format",
                formatStdin = true,
              },
            },
            nim = {
              {
                formatCommand = "nph -",
                formatStdin = true,
              }
            },
            nix = {
              {
                formatCommand = "${lib.getExe pkgs.alejandra} -",
                formatStdin = true,
              }
            },
            -- nu = {
            -- {
            -- formatCommand = "nufmt --stdin",
            -- formatStdin = true,
            -- }
            -- },
            python = {
              {
                formatCommand = "ruff format -",
                formatStdin = true,
              }
            },
            swift = {
              {
                formatCommand = "swift-format format",
                formatStdin = true,
              }
            },
            lua = {
              {
                formatCommand = "stylua --indent-type Spaces --indent-width 2 -",
                formatStdin = true,
              }
            },
            typst = {
              {
                formatCommand = "typstyle",
                formatStdin = true,
              }
            },
          },
        },
      }
    '';
    extraPackages = [pkgs.efm-langserver];
  };
}
