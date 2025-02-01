--- lua_source {{{
require("fidget").setup({
  notification = {
    poll_rate = 10, -- How frequently to update and render notifications
    filter = vim.log.levels.INFO, -- Minimum notifications level
    history_size = 128, -- Number of removed messages to retain in history
    override_vim_notify = false, -- Automatically override vim.notify() with Fidget
    -- How to configure notification groups when instantiated
    configs = { default = require("fidget.notification").default_config },
    -- Conditionally redirect notifications to another backend
    redirect = function(msg, level, opts)
      if opts and opts.on_open then
        return require("fidget.integration.nvim-notify").delegate(msg, level, opts)
      end
    end,
  },
})
--- }}}
