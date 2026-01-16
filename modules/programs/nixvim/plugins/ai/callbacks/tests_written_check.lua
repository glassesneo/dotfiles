-- Check if tests were written by looking for confirmation in chat
function(chat)
  if chat.messages and #chat.messages > 0 then
    local last_msg = chat.messages[#chat.messages]
    if last_msg and last_msg.content then
      local content = last_msg.content:lower()
      if content:match("tests written and failing") or
         content:match("tests.*written.*failing") or
         vim.g.codecompanion_tests_written == true then
        vim.g.codecompanion_tests_written = true
        return true
      end
    end
  end
  return false
end
