# Node.js package list for node2nix
# Categorized for clarity, flattened for output
let prelude = import "../lib/prelude.ncl" in

let mcp_servers | Array prelude.NpmPackage = [
  "@brave/brave-search-mcp-server",
  "@morph-llm/morph-fast-apply",
  "@mizchi/readability",
  "@modelcontextprotocol/server-google-maps",
  "tavily-mcp",
  "chrome-devtools-mcp",
  "kiri-mcp-server",
] in

let cli_tools | Array prelude.NpmPackage = [
  "@anthropic-ai/claude-code",
  "@openai/codex",
  "@zed-industries/claude-code-acp",
] in

# Flatten all categories into a single array
std.array.flatten [mcp_servers, cli_tools]
