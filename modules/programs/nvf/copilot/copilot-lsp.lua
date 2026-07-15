-- Copilot is repository-neutral, but privacy checks are fail-closed. Both the
-- candidate file and ~/orgfiles are resolved through realpath so symlinks
-- cannot bypass the boundary. Sensitive tokens are case-sensitive basename
-- substrings, preserving the existing policy.
local uv = vim.uv

local function resolved(path)
  if not path or path == "" then
    return nil
  end
  local value = uv.fs_realpath(vim.fs.normalize(path))
  if not value or value == "" then
    return nil
  end
  return vim.fs.normalize(value)
end

local function within(path, root)
  if path == root then
    return true
  end
  local prefix = root:match("/$") and root or (root .. "/")
  return path:sub(1, #prefix) == prefix
end

local function sensitive_basename(path)
  local basename = vim.fs.basename(path)
  if not basename or basename == "" then
    return true
  end
  for _, token in ipairs({ "env", "conf", "local", "private" }) do
    if basename:find(token, 1, true) then
      return true
    end
  end
  return false
end

function _G.nvf_copilot_should_attach(bufnr, buf_path)
  if not vim.api.nvim_buf_is_valid(bufnr) or not vim.bo[bufnr].buflisted or vim.bo[bufnr].buftype ~= "" then
    return false
  end

  local file = resolved(buf_path)
  local orgfiles = resolved(vim.fn.expand("~/orgfiles"))
  if not file or not orgfiles then
    return false
  end
  if within(file, orgfiles) or sensitive_basename(file) then
    return false
  end
  return true
end

function _G.nvf_copilot_root_dir()
  local file = resolved(vim.api.nvim_buf_get_name(0))
  if not file then
    return nil
  end
  return vim.fs.dirname(file)
end

function _G.nvf_copilot_on_attach(client, bufnr)
  if client:supports_method(vim.lsp.protocol.Methods.textDocument_inlineCompletion, bufnr) then
    vim.lsp.inline_completion.enable(true, { bufnr = bufnr })
  end
end
