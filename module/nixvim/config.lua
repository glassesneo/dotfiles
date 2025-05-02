-- vim.cmd("filetype plugin on")

--- lsp
-- vim.diagnostic.config({
-- severity_sort = true,
-- float = {
-- border = "single",
-- title = "Diagnostics",
-- header = {},
-- suffix = {},
-- format = function(diag)
-- if diag.code then
-- return string.format("[%s](%s): %s", diag.source, diag.code, diag.message)
-- else
-- return string.format("[%s]: %s", diag.source, diag.message)
-- end
-- end,
-- },
-- })

vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, {
  border = "rounded",
})
