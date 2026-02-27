# Claude Code Specific Directives

## MCP Servers in Plan Mode
- **In Plan Mode**, you can use **readonly MCP servers** for exploration and research
  - Examples: web search, code context search, documentation reading, time queries
  - These are safe to use as they don't modify the system
  - Avoid MCP servers that modify state, write files, or perform destructive operations

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
