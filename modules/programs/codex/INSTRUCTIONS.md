## Required Tool Usage

### Code Exploration and Editing
- **MUST** see CLAUDE.md in the project root if it exists
- **MUST** use Kiri MCP (`mcp__kiri__context_bundle`) to explore unfamiliar codebases
  - Kiri provides intelligent code context and dependency analysis
- **MUST** use Morph Fast Apply MCP (`mcp__morph-fast-apply__edit_file`) for large-scale edits (multiple changes, complex refactoring)
  - Fast Apply enables efficient edits with minimal context markers
- Use normal Edit tool for small, single changes to conserve Morph's API tokens
- When reviewing code changes, if you find specific issues, consider whether there might be underlying design problems

### Web Operations
- **MUST** use Brave Search MCP or Tavily MCP for web searches
- **MUST** use Readability MCP to fetch web page contents
- **NEVER** use builtin web search and fetch tools

### CLI Tools
- Use modern CLI alternatives:
  - `rg` instead of `grep`
  - `fd` instead of `find`
