local M = {}

local function refresh_root(bufnr)
  if not vim.api.nvim_buf_is_valid(bufnr) then
    return
  end
  if vim.bo[bufnr].buftype ~= "" then
    vim.b[bufnr].nvf_project_root = ""
    return
  end
  local root = vim.fs.root(bufnr, { ".git" })
  if not root then
    vim.b[bufnr].nvf_project_root = ""
    return
  end
  vim.b[bufnr].nvf_project_root = vim.fn.fnamemodify(root, ":t")
end

function M.root_area()
  local bufnr = vim.api.nvim_get_current_buf()
  local name = vim.b[bufnr].nvf_project_root
  if name == nil then
    refresh_root(bufnr)
    name = vim.b[bufnr].nvf_project_root
  end
  if not name or name == "" then
    return {}
  end
  return { { text = "  " .. name, link = "Directory" }, { text = "  │ ", link = "WinSeparator" } }
end

function M.branch_area()
  local head = vim.b.gitsigns_head
  if not head or head == "" then
    return {}
  end
  return { { text = "  " .. head .. " ", link = "String" } }
end

function M.setup()
  local group = vim.api.nvim_create_augroup("NvfTablineAreas", { clear = true })
  vim.api.nvim_create_autocmd({ "BufEnter", "DirChanged" }, {
    group = group,
    callback = function (event)
      refresh_root(event.buf)
    end,
  })
  vim.api.nvim_create_autocmd("User", {
    group = group,
    pattern = "GitSignsUpdate",
    callback = vim.schedule_wrap(function ()
      vim.cmd.redrawtabline()
    end),
  })
  refresh_root(vim.api.nvim_get_current_buf())
end

return M
