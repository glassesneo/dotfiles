vim.lsp.enable({ "emmylua_ls" })
vim.lsp.enable({ "sourcekit" })
vim.lsp.enable({ "denols" })
vim.lsp.enable({ "ts_ls" })
-- vim.lsp.enable({ "kotlin_lsp" })
vim.lsp.enable({ "efm" })

local library_paths = {
  vim.env.VIMRUNTIME .. "/lua",
  vim.env.VIMRUNTIME .. "/lua/vim/_meta", -- for EmmyLua
  vim.fn.stdpath("config") .. "/lua",
}

local unique_library_paths = {}
local seen_paths = {}
for _, path in ipairs(library_paths) do
  if path and not seen_paths[path] then
    table.insert(unique_library_paths, path)
    seen_paths[path] = true
  end
end

vim.lsp.config.emmylua_ls = {
  settings = {
    Lua = {
      runtime = {
        version = "LuaJIT",
        pathStrict = true,
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
  workspace_required = false,
}

-- vim.lsp.config.lua_ls = {
-- settings = {
-- Lua = {
-- runtime = {
-- version = "LuaJIT",
-- pathStrict = true,
-- },
-- diagnostics = {
-- globals = {"vim"},
-- },
-- workspace = {
-- library = unique_library_paths,
-- checkThirdParty = false,
-- ignoreDir = {
-- ".*",
-- },
-- },
-- telemetry = { enable = false },
-- hint = {
-- enable = true,
-- arrayIndex = "Enable",
-- setType = true,
-- },

-- },
-- },
-- }

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
    rootMarkers = { "deno.json", "deno.jsonc" },
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

vim.lsp.config.ts_ls = {
  single_file_support = true,
  settings = {
    typescript = {
      inlayHints = {
        includeInlayParameterNameHints = "all",
        includeInlayParameterNameHintsWhenArgumentMatchesName = true,
        includeInlayFunctionParameterTypeHints = true,
        includeInlayVariableTypeHints = true,
        includeInlayVariableTypeHintsWhenTypeMatchesName = true,
        includeInlayPropertyDeclarationTypeHints = true,
        includeInlayFunctionLikeReturnTypeHints = true,
        includeInlayEnumMemberValueHints = true,
      },
    },
  },
}

vim.lsp.config.efm = {
  init_options = {
    documentFormatting = true,
    documentRangeFormatting = true,
  },
  filetypes = {
    "elm",
    "go",
    "html",
    "nim",
    "nix",
    "prisma",
    "python",
    "swift",
    "lua",
    "typst",
    "typescript",
    "typescriptreact",
    "javascript",
  },
  settings = {
    root_markers = {
      ".git/",
    },
    languages = {
      elm = {
        {
          formatCommand = "elm-format --stdin",
          formatStdin = true,
        },
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
        },
      },
      nix = {
        {
          formatCommand = "alejandra -",
          formatStdin = true,
        },
      },
      -- nu = {
      -- {
      -- formatCommand = "nufmt --stdin",
      -- formatStdin = true,
      -- }
      -- },
      -- prisma = {
      -- {
      -- formatCommand = "prisma format --schema=${INPUT}",
      -- formatStdin = true,
      -- }
      -- },
      python = {
        {
          formatCommand = "ruff format -",
          formatStdin = true,
        },
      },
      swift = {
        {
          formatCommand = "swift-format format",
          formatStdin = true,
        },
      },
      lua = {
        {
          formatCommand = "stylua --indent-type Spaces --indent-width 2 -",
          formatStdin = true,
        },
      },
      typst = {
        {
          formatCommand = "typstyle",
          formatStdin = true,
        },
      },
      typescript = {
        {
          formatCommand = "biome check --stdin-file-path=${INPUT} --write",
          formatStdin = true,
        },
      },
      typescriptreact = {
        {
          formatCommand = "biome check --stdin-file-path=${INPUT} --write",
          formatStdin = true,
        },
      },
    },
  },
}

vim.lsp.config["moonbit-lsp"] = {
  cmd = { "moonbit-lsp" },
  filetypes = { "moonbit" },
  single_file_support = true,
  settings = {
    rootMarkers = { "moon.mod.json", ".git" },
  },
}

vim.lsp.enable({ "moonbit-lsp" })

