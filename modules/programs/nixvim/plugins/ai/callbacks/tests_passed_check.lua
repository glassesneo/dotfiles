-- Check if tests passed by looking for success indicators in chat
function(chat)
  local max_iterations = 5
  local current_iteration = vim.g.codecompanion_test_iterations or 0

  if chat.messages and #chat.messages > 0 then
    local last_msg = chat.messages[#chat.messages]
    if last_msg and last_msg.content then
      local content = last_msg.content:lower()
      if content:match("tests passed") or
         content:match("all tests pass") or
         content:match("test.*success") or
         vim.g.codecompanion_tests_passed == true then
        vim.g.codecompanion_tests_passed = true
        return true
      end
    end
  end

  if current_iteration >= max_iterations then
    vim.notify("Refactor-Test workflow: Max iterations reached", vim.log.levels.WARN)
    return true
  end

  return false
end
