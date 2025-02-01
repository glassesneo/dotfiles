--- lua_source {{{
local lspconfig = require("lspconfig")

require("lsp-format").setup({})

---@param client vim.lsp.Client
---@param bufnr? number
local lspformat_on_attach = function(client, bufnr)
  require("lsp-format").on_attach(client, bufnr)
end

local efm_languages = {}

local filetype_config = {
  elm = {
    efm = {
      {
        formatCommand = "elm-format --stdin",
        formatStdin = true,
      },
    },
  },
  -- go = {
  --   efm = {
  --     {
  --       formatCommand = "gofmt",
  --       formatStdin = true,
  --       lintCommand = "golangci-lint run",
  --       lintStdin = true,
  --     },
  --   },
  -- },
  -- haskell = {
  --   efm = {
  --     {
  --       formatCommand = "stack exec fourmolu --stdin-input-file",
  --       formatStdin = true,
  --     },
  --   },
  -- },
  lua = {
    efm = {
      {
        formatCommand = "stylua --indent-type Spaces --indent-width 2 -",
        formatStdin = true,
      },
    },
  },
  nim = {
    efm = {
      {
        formatCommand = "nph -",
        formatStdin = true,
      },
    },
  },
  nix = {
    efm = {
      {
        formatCommand = "nixfmt -",
        formatStdin = true,
      },
    },
  },
  python = {
    efm = {
      {
        formatCommand = "ruff format -",
        formatStdin = true,
      },
    },
  },
  scala = {
    efm = {
      {
        formatCommand = "scalafmt --stdin --non-interactive",
        formatCanRange = true,
        formatStdin = true,
      },
    },
  },
  sql = {
    filetypes = { "sql", "mysql" },
    efm = {
      {
        formatCommand = "sql-formatter",
        formatCanRange = true,
        formatStdin = true,
      },
    },
  },
  svelte = {},
  toml = {
    efm = {
      {
        formatCommand = "taplo format -",
        formatStdin = true,
      },
    },
  },
  typescript = {
    filetypes = { "typescript", "typescriptreact", "javascript" },
    efm = {
      {
        formatCommand = "biome check --apply --stdin-file-path '${INPUT}'",
        formatStdin = true,
        rootMarkers = { "biome.json", "package.json" },
      },
    },
  },
  kotlin = {
    filetypes = { "kotlin", "kotlin.kts" },
    efm = {
      {
        formatCommand = "ktfmt -",
        formatStdin = true,
      },
    },
  },
  v = {
    filetypes = { "v", "vsh", "vv" },
    efm = {
      {
        formatCommand = "v fmt",
        formatStdin = true,
      },
    },
  },
  zig = {
    filetypes = { "zig", "zir", "zon" },
    efm = {
      {
        formatCommand = "zig fmt --stdin",
        formatStdin = true,
      },
    },
  },
}

---@param ft string
---@param config { efm: table, extraSources: string[] }
local register_language = function(ft, config)
  efm_languages[ft] = config.efm or {}
end

for ft, config in pairs(filetype_config) do
  if config.filetypes ~= nil then
    for _, ft2 in ipairs(config.filetypes) do
      register_language(ft2, config)
    end
  else
    register_language(ft, config)
  end
end

require("ddc_source_lsp_setup").setup({
  override_capabilities = true,
  respect_trigger = true,
})

local servers = {
  efm = {
    on_attach = lspformat_on_attach,
    init_options = {
      documentFormatting = true,
      documentRangeFormatting = true,
    },
    single_file_support = true,
    settings = {
      rootMarkers = {
        ".git/",
      },
      languages = efm_languages,
    },
  },
  denols = {
    single_file_support = true,
    root_dir = lspconfig.util.root_pattern("deno.json"),
    settings = {
      deno = {
        inlayHints = {
          parameterNames = { enabled = "all", suppressWhenArgumentMatchesName = true },
          parameterTypes = { enabled = true },
          variableTypes = { enabled = true, suppressWhenTypeMatchesName = true },
          propertyDeclarationTypes = { enabled = true },
          functionLikeReturnTypes = { enable = true },
          enumMemberValues = { enabled = true },
        },
      },
    },
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
  },
  elmls = {
    root_dir = lspconfig.util.root_pattern("elm.json"),
  },
  gopls = {},
  -- hls = {},
  kotlin_language_server = {
    settings = {
      kotlin = {
        compiler = {
          jvm = {
            target = "21",
          },
        },
        hints = {
          typeHints = true,
          parameterHints = true,
          chaineHints = true,
        },
      },
    },
  },
  lua_ls = {
    settings = {
      Lua = {
        runtime = {
          version = "LuaJIT",
          pathStrict = true,
          path = { "?.lua", "?/init.lua" },
        },
        workspace = {
          library = vim.list_extend(vim.api.nvim_get_runtime_file("lua", true), {
            "${3rd}/luv/library",
            "${3rd}/busted/library",
            "${3rd}/luassert/library",
          }),
          checkThirdParty = false,
        },
        hint = {
          enable = true,
        },
      },
    },
  },
  marksman = {},
  metals = {},
  nil_ls = {
    settings = {
      flake = {
        autoArchive = true,
      },
    },
  },
  -- nim_langserver = {
  --   settings = {
  --     single_file_support = false,
  --   },
  -- },
  pylyzer = {
    settings = {
      python = {
        inlayHints = true,
      },
    },
  },
  sqlls = {},
  svelte = {
    on_attach = lspformat_on_attach,
    settings = {
      typescript = {
        inlayHints = {
          parameterNames = { enabled = "all" },
          parameterTypes = { enabled = true },
          variableTypes = { enabled = true },
          propertyDeclarationTypes = { enabled = true },
          functionLikeReturnTypes = { enabled = true },
          enumMemberValues = { enabled = true },
        },
      },
    },
  },
  taplo = {},
  ts_ls = {
    root_dir = lspconfig.util.root_pattern("package.json"),
    single_file_support = false,
    settings = {
      typescript = {
        includeInlayParameterNameHints = "all",
        includeInlayParameterNameHintsWhenArgumentMatchesName = false,
        includeInlayFunctionParameterTypeHints = true,
        includeInlayVariableTypeHints = true,
        includeInlayVariableTypeHintsWhenTypeMatchesName = false,
        includeInlayPropertyDeclarationTypeHints = true,
        includeInlayFunctionLikeReturnTypeHints = true,
        includeInlayEnumMemberValueHints = true,
      },
    },
  },
  vimls = {},
  v_analyzer = {},
  zls = {
    settings = {
      zls = {
        enable_snippets = true,
        enable_ast_check_diagnostics = true,
        enable_autofix = true,
        enable_import_embedfile_argument_completions = true,
        warn_style = true,
        enable_semantic_tokens = true,
        enable_inlay_hints = true,
        inlay_hints_show_builtin = true,
        inlay_hints_hide_redundant_param_names = true,
        inlay_hints_hide_redundant_param_names_last_token = true,
        operator_completions = true,
        include_at_in_builtins = true,
      },
    },
  },
}

for lsp, config in pairs(servers) do
  lspconfig[lsp].setup(config)
end
--- }}}
