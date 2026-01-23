function()
  local iteration = _G.CCWorkflowState.increment("tasks_completed")

  return string.format([[
Implementation Cycle %d:

Steps:
1. Check TODO.md for next uncompleted task
2. Implement using @{insert_edit_into_file}
3. Run tests with @{cmd_runner} if applicable
4. Update TODO.md (mark as - [x])
5. Respond: "TASK COMPLETE: [task name]"

When all tasks complete:
- Respond: "ALL TASKS COMPLETE"
- Delete TODO.md using @{cmd_runner}

Continue with next task.
]], iteration)
end
