-- Check if tests were written by looking for confirmation in chat
function(chat)
  local state = _G.CCWorkflowState
  if chat.messages and #chat.messages > 0 then
    local last_msg = chat.messages[#chat.messages]
    if last_msg and last_msg.content then
      local content = last_msg.content:lower()
      if content:match("tests written and failing") or
         content:match("tests.*written.*failing") or
         state.get("tests_written") == true then
        state.set("tests_written", true)
        return true
      end
    end
  end
  return false
end
