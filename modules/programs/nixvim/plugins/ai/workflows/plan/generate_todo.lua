function()
  -- Clean up state at workflow end
  _G.CCWorkflowState.reset_plan()

  local cwd = vim.fn.getcwd()
  return string.format([[
Generate the complete TODO.md file using @{create_file}.

REQUIRED STRUCTURE:

# Feature: [Feature Name]

## Overview
[Brief description of the feature and its purpose - 2-3 sentences]

## Task Breakdown

### 1. [Category Name] (e.g., Setup, Core Implementation, Testing)
- [ ] Task 1.1: [Clear, actionable task description]
  - Files: [Specific file paths]
  - Notes: [Implementation details if needed]
- [ ] Task 1.2: [Clear, actionable task description]

### 2. [Category Name]
- [ ] Task 2.1: [Clear, actionable task description]

## Testing Strategy
- [ ] Unit tests: [Specific test cases]
- [ ] Integration tests: [Specific workflows to test]

## Dependencies
- [List external dependencies or prerequisites]

## Implementation Order
1. [First task/category]
2. [Second task/category]
3. [Final task/category]

REQUIREMENTS:
1. Tasks must be small and atomic (completable in one session)
2. Organize by category: Setup, Core, Testing, Documentation
3. Include specific file paths and function names
4. Add implementation notes only for complex tasks
5. Provide clear implementation order
6. Include comprehensive testing tasks

File location: %s/TODO.md

After creation, respond: "TODO.md created successfully at %s/TODO.md"
]], cwd, cwd)
end
