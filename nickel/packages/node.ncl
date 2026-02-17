# INFORMATIONAL MANIFEST ONLY
#
# This Nickel file documents a categorized Node package list, but it is NOT
# currently wired into the active build pipeline. Active inputs are managed
# in node-packages/package.json and built via bun2nix.
#
# Integration between this file and the build is deferred to a follow-up effort.
# Do not treat edits here as build-affecting changes without explicit rewiring.
#
# Node.js package list (reference)
# Categorized for clarity, flattened for output
let prelude = import "../lib/prelude.ncl" in

let mcp_servers | Array prelude.NpmPackage = [
  "@brave/brave-search-mcp-server",
  "@morph-llm/morph-fast-apply",
  "@mizchi/readability",
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
