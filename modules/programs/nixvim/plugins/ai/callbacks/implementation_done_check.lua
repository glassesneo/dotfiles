-- Check if implementation is done and tests pass
function(chat)
  local state = _G.CCWorkflowState
  if chat.messages and #chat.messages > 0 then
    local last_msg = chat.messages[#chat.messages]
    if last_msg and last_msg.content then
      local content = last_msg.content:lower()
      if content:match("implementation complete") or
         content:match("tests.*pass") or
         content:match("all tests.*pass") or
         state.get("implementation_done") == true then
        state.set("implementation_done", true)
        return true
      end
    end
  end
  return false
end
