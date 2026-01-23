function()
  local iteration = _G.CCWorkflowState.get("test_iterations") or 1
  return string.format([[
[Fix-Test Cycle %d]

1. Check test results from @{cmd_runner}
2. If FAILED: Fix with @{insert_edit_into_file} then re-run with @{cmd_runner}
3. If PASSED: Respond with "TESTS PASSED" to end the cycle

Start NOW.
]], iteration)
end
