--- lua_source {{{
vim.api.nvim_create_autocmd("FileType", {
  group = vim.api.nvim_create_augroup("tsnode-marker-markdown", {}),
  pattern = "markdown",
  callback = function(context)
    require("tsnode-marker").set_automark(context.buf, {
      target = { "code_fence_content" }, -- list of target node types
      hl_group = "CursorLine", -- highlight group
    })
  end,
})
--- }}}
