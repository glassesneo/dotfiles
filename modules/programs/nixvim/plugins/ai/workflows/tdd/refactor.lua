function()
  local state = _G.CCWorkflowState
  local tests_written = state.get("tests_written")
  local impl_done = state.get("implementation_done")

  -- Clean up state at workflow end
  state.reset_tdd()

  return string.format([[
REFACTOR PHASE (Optional):

TDD Status:
- Tests Written: %s
- Implementation: %s

Now improve code quality:
1. Review the implementation for improvements
2. Refactor using @{insert_edit_into_file} if needed
3. Run tests with @{cmd_runner} after each change
4. Ensure tests still pass

Provide final summary:
- What tests were written
- What was implemented
- What was refactored
- Final test status

Keep summary concise.]],
    tests_written and "✓" or "✗",
    impl_done and "✓" or "✗")
end
