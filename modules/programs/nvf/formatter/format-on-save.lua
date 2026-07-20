return function (bufnr)
  if not vim.g.formatsave or vim.b[bufnr].disableFormatSave then
    return
  end

  local function web_route()
    local path = vim.api.nvim_buf_get_name(bufnr)
    if path == "" then
      return
    end
    local ok, typescript = pcall(require, "nvf.typescript")
    if ok then
      return typescript.route(path)
    end
  end

  local ft = vim.bo[bufnr].filetype
  if ft == "python" then
    local clients = vim.lsp.get_clients({ bufnr = bufnr, name = "ruff", method = "textDocument/formatting" })
    if clients[1] then
      return {
        lsp_format = "prefer",
        timeout_ms = 500,
        filter = function (client)
          return client.name == "ruff"
        end,
      }
    end
    return
  end

  ---@type table<string, true | nil>
  local lsp_only = { lua = true, zig = true, moonbit = true }
  if ft == "javascript" or ft == "javascriptreact" or ft == "typescript" or ft == "typescriptreact" then
    local route = web_route()
    if route == "biome" then
      -- Continue below and require an available Biome formatter.
    elseif route == "deno" or route == "typescript" then
      lsp_only[ft] = true
    else
      return
    end
  end

  if lsp_only[ft] then
    local clients = vim.lsp.get_clients({ bufnr = bufnr, method = "textDocument/formatting" })
    if clients[1] then
      return { lsp_format = "prefer", timeout_ms = 500 }
    end
    return
  end

  local conform = require("conform")
  for _, formatter in ipairs(conform.list_formatters(bufnr)) do
    if formatter.available then
      return { lsp_format = "never", timeout_ms = 500 }
    end
  end
end
