--- lua_add {{{
local artemis = require("artemis")
local doAction = artemis.fn.ddu.ui.do_action
local asyncAction = artemis.fn.ddu.ui.async_action
-- local customAction = artemis.fn.ddu.custom.action

---@param mode string|string[]
---@param key string
---@param action string
---@param args? table
local function mapAction(mode, key, action, args)
  local callback = (function()
    if args ~= nil and next(args) then
      return function()
        doAction(action, args)
      end
    else
      return function()
        doAction(action)
      end
    end
  end)()
  vim.keymap.set(mode, key, callback, { noremap = true, silent = true, buffer = true })
end

---@param mode string|string[]
---@param key string
---@param action string
---@param args? table
local function mapAsyncAction(mode, key, action, args)
  local callback = (function()
    if args ~= nil and next(args) then
      return function()
        doAction(action, args)
      end
    else
      return function()
        doAction(action)
      end
    end
  end)()
  vim.keymap.set(mode, key, callback, { noremap = true, silent = true, buffer = true })
end

artemis.fn.ddu.custom.load_config(vim.env.HOOK_DIR .. "/ddu.ts")

vim.api.nvim_create_autocmd("User", {
  pattern = "Ddu:uiDone",
  callback = function()
    if vim.bo.filetype ~= "ddu-ff" then
      return
    end
    asyncAction("openFilterWindow")
  end,
})

vim.api.nvim_create_autocmd("User", {
  pattern = "Ddu:uiOpenFilterWindow",
  callback = function()
    if vim.bo.filetype ~= "ddu-ff" then
      return
    end
    artemis.fn.ddu.ui.save_cmaps({ "<C-c>", "<C-n>", "<C-p>", "<CR>" })
    vim.keymap.set("c", "<CR>", function()
      doAction("itemAction", { name = "open" })
      vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "n", false)
    end)
    vim.keymap.set("c", "<C-c>", "<Esc>")
    mapAsyncAction("c", "<C-n>", "cursorNext", { loop = true })
    mapAsyncAction("c", "<C-p>", "cursorPrevious", { loop = true })
  end,
})

vim.api.nvim_create_autocmd("User", {
  pattern = "Ddu:uiCloseFilterWindow",
  callback = function()
    if vim.bo.filetype ~= "ddu-ff" then
      return
    end
    -- vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<C-c>", true, true, true), "n", false)
    artemis.fn.ddu.ui.restore_cmaps()
    doAction("quit")
  end,
})

-- ui-ff
vim.api.nvim_create_autocmd("FileType", {
  pattern = "ddu-ff",
  callback = function()
    vim.opt.cursorline = true
    vim.opt.cursorcolumn = false
  end,
})

vim.keymap.set("n", "<Space><Space>", function()
  artemis.fn.ddu.start({ name = "fuzzy_finder" })
end)

-- ddu-filer
-- local toggleGitStatus = function()
-- local current = artemis.fn.ddu.custom.get_current(vim.b.ddu_ui_name)
-- local converters = current["sourceOptions"]["file"]["converters"]
-- if #converters == 0 then
-- return { "converter_git_status" }
-- else
-- return {}
-- end
-- end

-- customAction("ui", "filer", "toggleGitStatus", function()
-- doAction("updateOptions", {
-- sourceOptions = {
-- file = {
-- converters = toggleGitStatus(),
-- },
-- },
-- })
-- doAction("redraw")
-- end)

vim.api.nvim_create_autocmd("FileType", {
  pattern = "ddu-filer",
  callback = function()
    vim.opt.cursorline = true
    vim.opt.cursorcolumn = false
    mapAction("n", "j", "cursorNext")
    mapAction("n", "k", "cursorPrevious")
    mapAction("n", "q", "quit")
    mapAction("n", "<CR>", "filerOpen")
    -- mapAction("n", "<C-CR>", "filerOpenAndLeave")
    mapAction("n", "l", "expandItem", { isInTree = true })
    mapAction("n", "h", "collapseItem")
    mapAction("n", "<S-l>", "expandItem", { maxLevel = -1, isInTree = true })
    mapAction("n", "r", "itemAction", { name = "rename" })
  end,
})

vim.keymap.set("n", "<Space>f", function()
  local windows = vim.api.nvim_list_wins()
  for _, win in ipairs(windows) do
    local buf = vim.api.nvim_win_get_buf(win)
    local buf_filetype = vim.api.nvim_get_option_value("filetype", { buf = buf })
    if buf_filetype == "ddu-filer" then
      vim.api.nvim_set_current_win(win)
      return
    end
  end
  artemis.fn.ddu.start({ name = "side_filer" })
end)
--- }}}
