{
  lsp = {
    inlayHints.enable = true;
    servers = {
      "*" = {
        settings = {
          capabilities.__raw = ''
            (function()
              local status, ddc_lsp = pcall(require, "ddc_source_lsp")
              if status then
                return ddc_lsp.make_client_capabilities()
              else
                return nil
              end
            end)()
          '';
        };
      };
      bashls = {
        enable = true;
        package = null;
      };
      basedpyright = {
        enable = true;
        package = null;
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
        settings = {
          filetypes = ["markdown"];
        };
      };
      nil_ls = {
        enable = true;
        package = null;
        settings = {
          cmd = ["nix" "run" "nixpkgs#nil"];
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
    lspconfig.enable = true;
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
    vim.lsp.enable({ "denols" })
    vim.lsp.enable({ "efm" })

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
      filetypes = {"elm", "nix", "nim", "python", "lua", "typst"},
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
          nim = {
            {
              formatCommand = "nph -",
              formatStdin = true,
            }
          },
          nix = {
            {
              formatCommand = "alejandra -",
              formatStdin = true,
            }
          },
          python = {
            {
              formatCommand = "ruff format -",
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
}
