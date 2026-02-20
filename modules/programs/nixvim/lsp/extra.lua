-- LSP extra.lua: Imperative Lua-only server configuration.
--
-- Responsibility split with lsp/default.nix:
--   Nix (default.nix):  Servers with nixvim schema support — enable, package, config attrs.
--   Lua (this file):    Servers without nixvim schema (emmylua_ls, sourcekit, denols,
--                        ts_ls, efm, moonbit-lsp) — vim.lsp.enable + vim.lsp.config.
--                        Also: settings requiring Lua-only APIs (workspace library paths,
--                        init_options, efm language/formatter definitions).
--
--   Executable gating: Both Lua-managed and Nixvim-managed PATH-based servers are
--                        conditionally enabled via guarded_enable when their executables
--                        are present. Store-pinned servers (bashls, nixd, nickel_ls)
--                        have activate = true and are always available.
--
-- Adding a new server? If nixvim has schema support, add to default.nix.
-- Otherwise, add vim.lsp.enable + vim.lsp.config here.

-- Server executable mapping for PATH-based servers
-- Only enable when executable is available to avoid health check warnings
local lsp_executables = {
  -- Lua-managed servers
  ["emmylua_ls"] = "emmylua_ls",
  ["sourcekit"] = "sourcekit-lsp",
  ["denols"] = "deno",
  ["ts_ls"] = "typescript-language-server",
  ["efm"] = "efm-langserver",
  ["moonbit-lsp"] = "moonbit-lsp",

  -- Nixvim-managed PATH-based servers
  ["elmls"] = "elm-language-server",
  ["hls"] = "haskell-language-server-wrapper",
  ["kotlin_language_server"] = "kotlin-language-server",
  ["marksman"] = "marksman",
  ["tinymist"] = "tinymist",
  ["zls"] = "zls",
  ["basedpyright"] = "basedpyright-langserver",
  ["biome"] = "biome",
  ["gopls"] = "gopls",
  ["nim_langserver"] = "nimlangserver",
  ["nushell"] = "nu",
  ["prismals"] = "prisma-language-server",
  ["taplo"] = "taplo",
}

-- Guarded LSP server enablement
-- Only enables server if executable is present in PATH at startup
local function guarded_enable(server_name)
  local exe = lsp_executables[server_name]
  if exe and vim.fn.executable(exe) == 1 then
    vim.lsp.enable({ server_name })
  end
end

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

-- Enable Lua-managed servers (executables from project-local environments)
-- NOTE: Executable-gated enablement prevents health check warnings when
-- project-local language servers are not available. Servers attach normally
-- when opened from an activated project environment (direnv/nix-direnv).
guarded_enable("emmylua_ls")
guarded_enable("sourcekit")
guarded_enable("denols")
guarded_enable("ts_ls")
guarded_enable("efm")
guarded_enable("moonbit-lsp")

-- Enable Nixvim-managed PATH-based servers (executables from project-local environments)
-- These servers have activate = false in default.nix and are conditionally enabled here.
guarded_enable("elmls")
guarded_enable("hls")
guarded_enable("kotlin_language_server")
guarded_enable("marksman")
guarded_enable("tinymist")
guarded_enable("zls")
guarded_enable("basedpyright")
guarded_enable("biome")
guarded_enable("gopls")
guarded_enable("nim_langserver")
guarded_enable("nushell")
guarded_enable("prismals")
guarded_enable("taplo")

