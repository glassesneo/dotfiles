if not vim.g.loaded_mcphub then
  return { fg = "#6c7086" } -- Gray for not loaded
end

local status = vim.g.mcphub_status or "stopped"
if status == "ready" or status == "restarted" then
  return { fg = "#50fa7b" } -- Green for connected
elseif status == "starting" or status == "restarting" then
  return { fg = "#ffb86c" } -- Orange for connecting
else
  return { fg = "#ff5555" } -- Red for error/stopped
end

