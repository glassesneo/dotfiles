function()
  local state = _G.CCWorkflowState
  local iterations = state.get("test_iterations") or 0
  local tests_passed = state.get("tests_passed") or false

  -- Clean up state at workflow end
  state.reset_refactor_test()

  return string.format([[
FINAL SUMMARY REQUIRED

Completed after %d fix-test iteration(s).
Test Status: %s

Please provide:
1. What refactoring was performed?
2. Final test status
3. Any remaining issues or recommendations

Keep this summary concise.
]], iterations, tests_passed and "PASSED ✓" or "FAILED or UNKNOWN")
end
