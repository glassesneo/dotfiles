-- Copilot runtime policy for copilot.lua backed by copilot-language-server.
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

local function should_skip_path(buf_path)
  if path_is_within(realpath_or_self(buf_path), orgfiles_dir) then
    return true
  end

  local fname = vim.fs.basename(buf_path)
  if fname == nil or fname == "" then
    return false
  end

  local disable_patterns = { "env", "conf", "local", "private" }
  return vim.iter(disable_patterns):any(function(pattern)
    return string.match(fname, pattern) ~= nil
  end)
end

local function git_root_for_bufnr(bufnr)
  return vim.fs.root(bufnr, { ".git" }) or vim.fs.root(vim.fn.getcwd(), { ".git" })
end

return {
  -- Keep panel enabled so copilot.lua does not disable server-side auto completions.
  panel = { enabled = true },
  suggestion = { enabled = false },
  filetypes = {
    gitcommit = true,
  },
  server = {
    type = "binary",
    custom_server_filepath = "copilot-language-server",
  },
  root_dir = function()
    return git_root_for_bufnr(0) or vim.fn.getcwd()
  end,
  should_attach = function(bufnr, buf_path)
    if not vim.bo[bufnr].buflisted or vim.bo[bufnr].buftype ~= "" then
      return false
    end

    if should_skip_path(buf_path) then
      return false
    end

    return git_root_for_bufnr(bufnr) ~= nil
  end,
  server_opts_overrides = {
    on_attach = function(client, bufnr)
      if client:supports_method(vim.lsp.protocol.Methods.textDocument_inlineCompletion, bufnr) then
        vim.lsp.inline_completion.enable(true, { bufnr = bufnr })
      end
    end,
  },
}
