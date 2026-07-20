-- PATH-only language servers. Project devShells own the executables; this
-- configuration must remain safe when any or all commands are absent.
local uv = vim.uv

local function buffer_path(bufnr)
  local path = vim.api.nvim_buf_get_name(bufnr)
  if path == "" then
    return nil
  end
  return vim.fs.normalize(path)
end

local function path_exists(path)
  return uv.fs_stat(path) ~= nil
end

local function nearest_marker(path, markers)
  local dir = vim.fs.dirname(path)
  while dir and dir ~= "" do
    for _, marker in ipairs(markers) do
      if path_exists(dir .. "/" .. marker) then
        return dir
      end
    end
    local parent = vim.fs.dirname(dir)
    if not parent or parent == dir then
      break
    end
    dir = parent
  end
  return nil
end

local function file_root(path)
  return vim.fs.dirname(path)
end

local function lua_root(path)
  return nearest_marker(path, { ".emmyrc.json", ".emmyrc.lua", ".luarc.json", ".git" }) or file_root(path)
end

local function python_root(path)
  return nearest_marker(path, {
    "ty.toml",
    "pyproject.toml",
    "ruff.toml",
    ".ruff.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    ".git",
  }) or file_root(path)
end

-- Deno has priority over Biome at every ancestor. Ordinary TypeScript is the
-- fallback only when neither marker exists, so primary web clients never
-- overlap. The formatter module consumes the same routing function.
function _G.nvf_web_route(path)
  if not path or path == "" then
    return nil, nil
  end
  local deno_root = nearest_marker(path, { "deno.json", "deno.jsonc" })
  if deno_root then
    return "deno", deno_root
  end
  local biome_root = nearest_marker(path, { "biome.json", "biome.jsonc" })
  if biome_root then
    return "biome", biome_root
  end
  return "typescript", nearest_marker(path, { "tsconfig.json", "jsconfig.json", "package.json" }) or file_root(path)
end

function _G.nvf_web_formatters(bufnr)
  local path = buffer_path(bufnr)
  if not path then
    return {}
  end
  local route = _G.nvf_web_route(path)
  return route == "biome" and { "biome" } or {}
end

local function gated_root(command, resolve)
  return function (bufnr, on_dir)
    if vim.fn.executable(command) ~= 1 then
      return
    end
    local path = buffer_path(bufnr)
    if not path then
      return
    end
    local root = resolve(path)
    if root and root ~= "" then
      on_dir(root)
    end
  end
end

local function web_root(command, route)
  return gated_root(command, function (path)
    local selected, root = _G.nvf_web_route(path)
    if selected == route then
      return root
    end
  end)
end

local capabilities = vim.lsp.protocol.make_client_capabilities()
local blink_ok, blink = pcall(require, "blink.cmp")
if blink_ok then
  capabilities = blink.get_lsp_capabilities(capabilities)
end

local lua_library_paths = {
  vim.env.VIMRUNTIME .. "/lua", vim.env.VIMRUNTIME .. "/lua/vim/_meta", vim.fn.stdpath("config") .. "/lua",
}

local unique_lua_library_paths = {}
local seen_lua_library_paths = {}
for _, path in ipairs(lua_library_paths) do
  if path and not seen_lua_library_paths[path] then
    table.insert(unique_lua_library_paths, path)
    seen_lua_library_paths[path] = true
  end
end

local servers = {
  bashls = {
    cmd = { "bash-language-server", "start" },
    filetypes = { "bash", "sh" },
    root_dir = gated_root("bash-language-server", file_root),
  },
  clangd = {
    cmd = { "clangd", "--clang-tidy" },
    filetypes = { "c", "cpp", "objc", "objcpp" },
    root_dir = gated_root("clangd", file_root),
  },
  marksman = {
    cmd = { "marksman", "server" },
    filetypes = { "markdown", "markdown.mdx" },
    root_dir = gated_root("marksman", file_root),
  },
  tinymist = {
    cmd = { "tinymist" },
    filetypes = { "typst" },
    root_dir = gated_root("tinymist", file_root),
    settings = { formatterMode = "typstyle" },
  },
  ty = {
    cmd = { "ty", "server" },
    filetypes = { "python" },
    root_dir = gated_root("ty", python_root),
  },
  ruff = {
    cmd = { "ruff", "server" },
    filetypes = { "python" },
    root_dir = gated_root("ruff", python_root),
  },
  nushell = {
    cmd = { "nu", "--no-config-file", "--lsp" },
    filetypes = { "nu" },
    root_dir = gated_root("nu", file_root),
  },
  zls = {
    cmd = { "zls" },
    filetypes = { "zig", "zir" },
    root_dir = gated_root("zls", file_root),
    settings = { zls = { enable_inlay_hints = true, warn_style = true } },
  },
  emmylua_ls = {
    cmd = { "emmylua_ls", "--editor", "neovim" },
    filetypes = { "lua" },
    root_dir = gated_root("emmylua_ls", lua_root),
    settings = {
      emmylua = {
        diagnostic = {
          enable = true,
        },
        runtime = { version = "LuaJIT" },
        workspace = {
          library = unique_lua_library_paths,
          ignoreDir = { ".direnv", ".git" },
        },
        hint = { enable = true },
        strict = { requirePath = true },
      },
    },
  },
  moonbit = {
    cmd = { "moonbit-lsp" },
    filetypes = { "moonbit" },
    root_dir = gated_root("moonbit-lsp", function (path)
      return nearest_marker(path, { "moon.mod.json" }) or file_root(path)
    end),
  },
  denols = {
    cmd = { "deno", "lsp" },
    filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
    root_dir = web_root("deno", "deno"),
    init_options = { lint = true, unstable = true },
  },
  biome = {
    cmd = { "biome", "lsp-proxy" },
    filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
    root_dir = web_root("biome", "biome"),
  },
  ts_ls = {
    cmd = { "typescript-language-server", "--stdio" },
    filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
    root_dir = web_root("typescript-language-server", "typescript"),
  },
}

for name, config in pairs(servers) do
  config.capabilities = capabilities
  vim.lsp.config[name] = config
  vim.lsp.enable(name)
end
