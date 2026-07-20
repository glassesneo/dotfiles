local M = {}
local uv = vim.uv

function M.buffer_path(bufnr)
  local path = vim.api.nvim_buf_get_name(bufnr)
  if path == "" then
    return nil
  end
  return vim.fs.normalize(path)
end

local function path_exists(path)
  return uv.fs_stat(path) ~= nil
end

function M.nearest_marker(path, markers)
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

function M.file_root(path)
  return vim.fs.dirname(path)
end

function M.gated_root(command, resolve)
  return function (bufnr, on_dir)
    if vim.fn.executable(command) ~= 1 then
      return
    end
    local path = M.buffer_path(bufnr)
    if not path then
      return
    end
    local root = resolve(path)
    if root and root ~= "" then
      on_dir(root)
    end
  end
end

local capabilities
local function lsp_capabilities()
  if capabilities ~= nil then
    return capabilities
  end

  capabilities = vim.lsp.protocol.make_client_capabilities()
  local blink_ok, blink = pcall(require, "blink.cmp")
  if blink_ok then
    capabilities = blink.get_lsp_capabilities(capabilities)
  end
  return capabilities
end

function M.setup(name, command, resolve, config)
  config.capabilities = lsp_capabilities()
  config.root_dir = M.gated_root(command, resolve)
  vim.lsp.config[name] = config
  vim.lsp.enable(name)
end

return M
