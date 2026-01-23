function()
  local iteration = _G.CCWorkflowState.increment("test_iterations")

  return string.format([[
Now analyze test results and fix any failures (Iteration %d).

CRITICAL INSTRUCTIONS:
1. Check the most recent @{cmd_runner} output for test results
2. If tests PASSED: Set the completion flag and stop
3. If tests FAILED: You MUST:
   a. Use @{insert_edit_into_file} to fix the issues
   b. Use @{cmd_runner} to run tests again
   c. DO NOT just explain - FIX IT

After fixing and re-running tests:
- If tests now pass: Say "TESTS PASSED" in your response
- If tests still fail: Explain what you fixed and try again

DO NOT end without either fixing issues or confirming tests pass.
]], iteration)
end
