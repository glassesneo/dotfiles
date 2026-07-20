local lsp = require("nvf.lsp")

local function lua_root(path)
  return lsp.nearest_marker(path, { ".emmyrc.json", ".emmyrc.lua", ".luarc.json", ".git" }) or lsp.file_root(path)
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

lsp.setup("emmylua_ls", "emmylua_ls", lua_root, {
  cmd = { "emmylua_ls", "--editor", "neovim" },
  filetypes = { "lua" },
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
})
