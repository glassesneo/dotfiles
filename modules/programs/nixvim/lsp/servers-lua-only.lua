-- Lua-owned servers without nixvim schema support or with Lua-only APIs.
local lua_only_executables = {
  ["emmylua_ls"] = "emmylua_ls",
  ["sourcekit"] = "sourcekit-lsp",
  ["denols"] = "deno",
  ["ts_ls"] = "typescript-language-server",
  ["moonbit-lsp"] = "moonbit-lsp",
}

local library_paths = {
  vim.env.VIMRUNTIME .. "/lua",
  vim.env.VIMRUNTIME .. "/lua/vim/_meta",
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

vim.lsp.config["moonbit-lsp"] = {
  cmd = { "moonbit-lsp" },
  filetypes = { "moonbit" },
  single_file_support = true,
  settings = {
    rootMarkers = { "moon.mod.json", ".git" },
  },
}
