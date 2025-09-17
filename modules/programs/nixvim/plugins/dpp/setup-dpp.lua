local dpp = require("dpp")

local dpp_base = vim.env.XDG_CACHE_HOME .. "/dpp"
local dpp_config = vim.env.XDG_CONFIG_HOME .. "/dpp/dpp.ts"

if dpp.load_state(dpp_base) then
  vim.api.nvim_create_autocmd("User", {
    pattern = "DenopsReady",
    callback = function()
      vim.notify("vim load_state is failed")
      dpp.make_state(dpp_base, dpp_config)
    end,
  })
end

vim.api.nvim_create_autocmd("User", {
  pattern = "Dpp:makeStatePost",
  callback = function()
    vim.notify("dpp make_state() is done")
  end,
})

-- install
vim.api.nvim_create_user_command("DppInstall", "call dpp#async_ext_action('installer', 'install')", {})

-- update
vim.api.nvim_create_user_command("DppUpdate", function(opts)
  local args = opts.fargs
  vim.fn["dpp#async_ext_action"]("installer", "update", { names = args })
end, { nargs = "*" })

-- check update
vim.api.nvim_create_user_command("DppCheckUpdate", "call dpp#async_ext_action('installer', 'checkNotUpdated')", {})

vim.api.nvim_create_user_command("DppClearState", "call dpp#clear_state()", {})
