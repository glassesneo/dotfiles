# INFORMATIONAL MANIFEST ONLY
#
# This Nickel file documents a categorized Node package list, but it is NOT
# currently wired into the active node2nix generation pipeline. Active inputs
# are managed under node2nix/node-packages.json and related generated Nix files.
#
# Integration between this file and node2nix is deferred to a follow-up effort.
# Do not treat edits here as build-affecting changes without explicit rewiring.
#
# Node.js package list for node2nix
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
