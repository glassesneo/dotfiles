-- Check if all implementation tasks are complete
function(chat)
  local max_tasks = 20
  local completed = vim.g.codecompanion_tasks_completed or 0

  if completed >= max_tasks then
    vim.notify("Implementation: Max tasks reached", vim.log.levels.WARN)
    return true
  end

  if chat.messages and #chat.messages > 0 then
    local last_msg = chat.messages[#chat.messages]
    if last_msg and last_msg.content then
      local content = last_msg.content:lower()
      if content:match("all tasks complete") or
         content:match("all tasks.*complete") or
         content:match("implementation.*complete") then
        return true
      end
    end
  end

  return false
end
