if not vim.g.loaded_mcphub then
  return "󰐻 -"
end

local count = vim.g.mcphub_servers_count or 0
local status = vim.g.mcphub_status or "stopped"
local executing = vim.g.mcphub_executing

-- Show "-" when stopped
if status == "stopped" then
  return "󰐻 -"
end

-- Show spinner when executing, starting, or restarting
if executing or status == "starting" or status == "restarting" then
  local frames = { "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏" }
  local frame = math.floor(vim.uv.now() / 100) % #frames + 1
  return "󰐻 " .. frames[frame]
end

return "󰐻 " .. count
