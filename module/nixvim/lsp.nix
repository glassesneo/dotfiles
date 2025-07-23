{
  lsp = {
    inlayHints.enable = true;
    servers = {
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
      marksman = {
        enable = true;
        package = null;
        settings = {
          filetypes = ["markdown"];
        };
      };
      nil_ls = {
        # enable = true;
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
      nixd = {
        enable = true;
        package = null;
        settings = {
          cmd = ["nix" "run" "nixpkgs#nixd"];
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
      sourcekit = {
        enable = true;
        package = null;
        settings = {
          cmd = ["sourcekit-lsp"];
        };
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
    vim.lsp.enable({ "lua_ls" })
    vim.lsp.enable({ "denols" })
    vim.lsp.enable({ "efm" })


    local library_paths = {
        vim.env.VIMRUNTIME.. "/lua",
        vim.env.VIMRUNTIME.. "/lua/vim/_meta", -- for EmmyLua
        vim.fn.stdpath('config').. "/lua",
    }

    -- optional: add a certain plugin's path
    -- local plugin_paths = vim.api.nvim_get_runtime_file("lua/my_plugin_name", true)
    -- for _, path in ipairs(plugin_paths) do table.insert(library_paths, path) end

    local unique_library_paths = {}
    local seen_paths = {}
    for _, path in ipairs(library_paths) do
      if path and not seen_paths[path] then
        table.insert(unique_library_paths, path)
        seen_paths[path] = true
      end
    end

    -- local make_capabilities = function()
      -- local status, ddc_lsp = pcall(require, "ddc_source_lsp")
      -- if status then
          -- return ddc_lsp.make_client_capabilities()
      -- else
        -- return nil
        -- end
    -- end

    vim.lsp.config("*", {
      -- capabilities = make_capabilities()
    })

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
}
