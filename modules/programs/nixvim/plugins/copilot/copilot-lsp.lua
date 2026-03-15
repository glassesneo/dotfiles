-- Copilot LSP runtime config: cmd, root_dir policy, on_attach.
local orgfiles_dir = vim.fs.normalize(vim.fn.expand("~/orgfiles"))

local function realpath_or_self(path)
  local uv = vim.uv
  local resolved = uv.fs_realpath(path)
  if resolved and resolved ~= "" then
    return resolved
  end
  return path
end

local function path_is_within(path, root)
  if not path or path == "" or not root or root == "" then
    return false
  end
  local normalized_path = vim.fs.normalize(path)
  local normalized_root = vim.fs.normalize(root)
  if normalized_path == normalized_root then
    return true
  end
  local root_with_sep = normalized_root:match("/$") and normalized_root or (normalized_root .. "/")
  return normalized_path:sub(1, #root_with_sep) == root_with_sep
end

vim.lsp.config.copilot = {
  cmd = { "copilot-language-server", "--stdio" },
  root_dir = function(bufnr, callback)
    local buf_path = vim.api.nvim_buf_get_name(bufnr)
    if path_is_within(realpath_or_self(buf_path), orgfiles_dir) then
      return
    end

    local fname = vim.fs.basename(buf_path)
    local disable_patterns = { "env", "conf", "local", "private" }
    local is_disabled = vim.iter(disable_patterns):any(function(pattern)
      return string.match(fname, pattern)
    end)
    if is_disabled then
      return
    end

    local root_dir = vim.fs.root(bufnr, { ".git" })
    if root_dir then
      callback(root_dir)
    end
  end,
  on_attach = function(_client, bufnr)
    vim.lsp.inline_completion.enable(true, { bufnr = bufnr })
  end,
}
