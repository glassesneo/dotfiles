function()
  local state = _G.CCWorkflowState
  local tasks_completed = state.get("tasks_completed") or 0

  -- Clean up state at workflow end
  state.reset_implementation()

  return string.format([[
FINAL VERIFICATION:

Completed %d implementation cycles.

Please provide:
1. Summary of what was implemented
2. Which tasks from TODO.md were completed
3. Any tasks that were skipped or modified
4. Test results summary
5. Recommended next steps

Also run final tests with @{cmd_runner} to ensure everything works.

Keep summary concise (under 10 lines).
]], tasks_completed)
end
