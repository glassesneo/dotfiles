function()
  local state = _G.CCWorkflowState
  state.set("tests_passed", false)
  state.set("test_iterations", 0)

  return [[
Now your job is to run tests. You MUST:
1. Use @{cmd_runner} to execute the test suite
2. DO NOT skip this step
3. Wait for test results before proceeding

Common test commands by language:
- Python: pytest, python -m pytest, python -m unittest
- JavaScript/TypeScript: npm test, yarn test, pnpm test
- Rust: cargo test
- Go: go test ./...
- Ruby: rspec, rake test
- Java: mvn test, gradle test
- Nix: nix flake check, nix build

Execute the appropriate test command NOW.
]]
end
