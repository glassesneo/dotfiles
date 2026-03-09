-- Activation only. Keep all config blocks in the files loaded before this one.
local function sorted_keys(tbl)
  local keys = vim.tbl_keys(tbl)
  table.sort(keys)
  return keys
end

local function merge_executable_maps(...)
  local merged = {}
  for index = 1, select("#", ...) do
    local mapping = select(index, ...) or {}
    for server_name, executable in pairs(mapping) do
      merged[server_name] = executable
    end
  end
  return merged
end

local guarded_executables = merge_executable_maps(path_gated_executables, lua_only_executables, exception_executables)

local function guarded_enable(server_name)
  local executable = guarded_executables[server_name]
  if executable and vim.fn.executable(executable) == 1 then
    vim.lsp.enable({ server_name })
  end
end

for _, server_name in ipairs(sorted_keys(lua_only_executables)) do
  guarded_enable(server_name)
end

for _, server_name in ipairs(sorted_keys(exception_executables)) do
  guarded_enable(server_name)
end

for _, server_name in ipairs(sorted_keys(path_gated_executables)) do
  guarded_enable(server_name)
end
