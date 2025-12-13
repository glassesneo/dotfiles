# CRITICAL DIRECTIVES

## Development Methodology

**Predictability beats cleverness.** Plans and implementations should be straightforward and predictable.

### Choosing the Right Approach
- **MUST** choose between TDD and Batch Test-First approaches based on the development context
- For large and complex problems, select and combine approaches based on uncertainty and complexity at each layer
- When asking clarifying questions to the user, ask comprehensive questions that elicit thorough answers

### TDD (Test-Driven Development)
- **Definition**: A methodology where tests drive the development process
- **Goal**: Clean code that works
- **Method**: Ultra-short Red→Green→Refactor cycles (minutes per cycle)
  - **Red**: Write a test first, run it, and watch it fail
  - **Green**: Implement production code to make the test pass
  - **Refactor**: Improve the design while keeping tests green

**When to use TDD:**
- High complexity and uncertainty where perfect upfront design is impossible
- When the design itself needs to evolve dynamically through feedback

### Batch Test-First Approach
- **Definition**: Writing all tests for a unit (e.g., a feature) upfront before implementing production code
- **Goal**: Clarify specifications and define completion criteria
- **Method**: Write all tests for a feature before implementation
  - Example: For a discount calculator, write tests for valid discounts, zero/negative amount edge cases, and upper limit checks all at once

**When to use Batch Test-First:**
- New feature implementation where the API interface is already finalized
- Refactoring existing functionality
- Medium to large-scale bug fixes

### Integration with Codex MCP
- **Before TDD Red phase**: Ask Codex to analyze existing code and identify edge cases, boundary conditions, and potential failure modes to test
- **Before Batch Test-First**: Ask Codex to review test case coverage against specifications and existing codebase patterns
- **During Refactor phase**: Ask Codex to propose refactoring strategies, then implement with Claude Code
- **After implementation**: Follow existing code review process with Codex

## AI Assistant Delegation
- **Codex MCP** (`mcp__codex__codex`): Best for code reading, analysis, and planning refactoring
  - When to use Codex:
    - Analyzing the codebase for refactoring opportunities
    - Planning feature implementation before writing code
    - Debugging complex issues by exploring code relationships
    - Understanding unfamiliar codebases and creating implementation plans
    - Batch processing tasks that require some reasoning—too complex for sed/awk but tedious to do manually
  - Codex is less likely to overlook bugs and implementation issues during source code exploration compared to other agents
  - Always perform a lightweight exploration yourself first before asking Codex
    - Sharing context improves the precision of your requests to Codex and your understanding of its responses
  - Treat Codex like a subagent for exploration and planning tasks
  - **NEVER** use Codex for implementing new features (use Claude Code for implementation)
  - **NEVER** specify `reasoning-effort = "high"` when calling Codex MCP
  - Use gpt-5.1-codex-max as a model for regular tasks
  - Use gpt-5.2 with low or medium `reasoning-effort` as a model for tiny tasks
- After Codex provides a plan, implement features yourself using TDD approach
- **MUST** ask Codex MCP to review changes after implementing features or significant refactorings
  - Use Codex to analyze uncommitted changes for potential issues, bugs, and improvements
  - Provide context about the changes and ask for thorough review
  - Address any concerns raised before committing

## Required Tool Usage

### Code Exploration and Editing
- **MUST** use Kiri MCP (`mcp__kiri__context_bundle`) to explore unfamiliar codebases
  - Kiri provides intelligent code context and dependency analysis
- **MUST** use Morph Fast Apply MCP (`mcp__morph-fast-apply__edit_file`) for large-scale edits (multiple changes, complex refactoring)
- Use normal Edit tool for small, single changes to conserve Morph's API tokens

### Web Operations
- **MUST** use Brave Search MCP or Tavily MCP for web searches
- **MUST** use Readability MCP to fetch web page contents
- **NEVER** use built-in web search and fetch tools

### CLI Tools
- Use modern CLI alternatives:
  - `rg` instead of `grep`
  - `fd` instead of `find`

### Package Management
- **MUST** use Nix exclusively as package manager
