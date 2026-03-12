# Claude Code Specific Directives

## MCP Servers in Plan Mode
- **In Plan Mode**, you can use **readonly MCP servers** for exploration and research
  - Examples: web search, code context search, documentation reading, time queries
  - These are safe to use as they don't modify the system
  - Avoid MCP servers that modify state, write files, or perform destructive operations

## Required Tool Usage

### Code Exploration
- Use `Read`, `Glob`, `Grep`, and the `Explore` subagent for codebase navigation
- Use `context7` MCP for official library/framework documentation
- Use `deepwiki` MCP for repository-level architecture details

### Web Operations
- **MUST** use Brave Search MCP or Web Search Prime MCP for web searches (both have rate limits — alternate to avoid throttling)
- **MUST** use Readability MCP or Web Reader MCP to fetch web page contents
- **NEVER** use built-in web search and fetch tools

## Proactive Delegation

### Code Review
- After implementation work, proactively delegate to the `code_reviewer` subagent to review changes before considering the task complete.
- The reviewer is read-only and returns severity-ordered findings with evidence and fix direction.

### Testing
- When a task changes behavior, touches tests, or carries medium/high regression risk, proactively delegate to the `tester` subagent.
- The tester runs validation commands, classifies failures, and writes failure reports for non-trivial issues.
