require("commons.keymaps")
require("commons.options")

require("os").setlocale("C")
vim.env.LANG = "en_US.UTF-8"

local currentDir = vim.fn.fnamemodify(vim.fn.expand("<sfile>"), ":p:h")
vim.env.BASE_DIR = currentDir
vim.env.RC_DIR = currentDir .. "/rc"
vim.env.PLUGIN_DIR = currentDir .. "/plugins"
vim.env.HOOK_DIR = currentDir .. "/hooks"

local dpp_src = "$XDG_CACHE_HOME/dpp/repos/github.com/Shougo/dpp.vim"
local denops_src = "$XDG_CACHE_HOME/dpp/repos/github.com/vim-denops/denops.vim"

vim.opt.runtimepath:prepend(dpp_src)
local dpp = require("dpp")

local dpp_base = "$XDG_CACHE_HOME/dpp"
local dpp_config = "$RC_DIR/dpp.ts"

local ext_toml = "$XDG_CACHE_HOME/dpp/repos/github.com/Shougo/dpp-ext-toml"
local ext_lazy = "$XDG_CACHE_HOME/dpp/repos/github.com/Shougo/dpp-ext-lazy"
local ext_installer = "$XDG_CACHE_HOME/dpp/repos/github.com/Shougo/dpp-ext-installer"
local ext_git = "$XDG_CACHE_HOME/dpp/repos/github.com/Shougo/dpp-protocol-git"

vim.opt.runtimepath:append(ext_git)
vim.opt.runtimepath:append(ext_installer)
vim.opt.runtimepath:append(ext_lazy)
vim.opt.runtimepath:append(ext_toml)

-- vim.g.denops_server_addr = "127.0.0.1:32121"

if dpp.load_state(dpp_base) then
  vim.opt.runtimepath:prepend(denops_src)

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

vim.api.nvim_create_autocmd({ "BufWritePost" }, {
  pattern = { "init.lua", "$HOOK_DIR/*.lua", "$PLUGIN_DIR/*.toml", "$RC_DIR/*.ts" },
  callback = function()
    dpp.check_files()
  end,
})

--- install
vim.api.nvim_create_user_command("DppInstall", "call dpp#async_ext_action('installer', 'install')", {})

-- update
vim.api.nvim_create_user_command("DppUpdate", function(opts)
  local args = opts.fargs
  vim.fn["dpp#async_ext_action"]("installer", "update", { names = args })
end, { nargs = "*" })

-- check update
vim.api.nvim_create_user_command("DppCheckUpdate", "call dpp#async_ext_action('installer', 'checkNotUpdated')", {})

vim.api.nvim_create_user_command("DppClearState", "call dpp#clear_state()", {})

vim.cmd("filetype plugin on")

--- lsp
vim.diagnostic.config({ severity_sort = true })

vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, {
  border = "rounded",
})
vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("UserLspConfig", {}),
  callback = function(ev)
    local client = vim.lsp.get_client_by_id(ev.data.client_id)
    if client == nil then
      return
    end

    if client.supports_method("textDocument/inlayHint") then
      vim.lsp.inlay_hint.enable()
    end
  end,
})

-- debug
vim.opt.runtimepath:append("~/Desktop/dev/project/vim-plugin/defined.vim")

-- vim.g["denops#debug"] = 1
