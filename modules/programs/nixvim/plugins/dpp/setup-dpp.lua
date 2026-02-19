local dpp = require("dpp")

local dpp_base = vim.env.XDG_CACHE_HOME .. "/dpp"
local dpp_config = vim.env.XDG_CONFIG_HOME .. "/dpp/dpp.ts"
local dpp_state_dir = dpp_base .. "/nvim"
local dpp_state_file = dpp_state_dir .. "/state.vim"
local dpp_startup_file = dpp_state_dir .. "/startup.vim"
local dpp_runtime_marker = dpp_state_dir .. "/runtimepath.txt"

local function clear_state_cache()
  vim.fn.delete(dpp_state_file)
  vim.fn.delete(dpp_startup_file)
  vim.fn.delete(dpp_runtime_marker)
end

local function needs_state_reset(current_runtime)
  local cached_runtime = nil

  if vim.fn.filereadable(dpp_runtime_marker) == 1 then
    cached_runtime = vim.fn.readfile(dpp_runtime_marker, "", 1)[1]
  end

  if cached_runtime ~= nil then
    return cached_runtime ~= current_runtime
  end

  if vim.fn.filereadable(dpp_startup_file) == 0 then
    return false
  end

  local startup_vim = table.concat(vim.fn.readfile(dpp_startup_file), "\n")
  return string.find(startup_vim, current_runtime, 1, true) == nil
end

local function sync_runtime_marker(current_runtime)
  vim.fn.mkdir(dpp_state_dir, "p")
  vim.fn.writefile({ current_runtime }, dpp_runtime_marker)
end

local current_runtime = vim.env.VIMRUNTIME or ""
if current_runtime ~= "" and needs_state_reset(current_runtime) then
  clear_state_cache()
end

if current_runtime ~= "" then
  sync_runtime_marker(current_runtime)
end

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
