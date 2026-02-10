let validate = import "../../validate.ncl" in

validate {
  servers = {
    node-server = {
      url = "https://example.invalid/mcp",
      needs_node = true,
    },
  },

  enabled = {
    mcphub = ["node-server"],
    claude_code = ["node-server"],
    claude_desktop = ["node-server"],
    codex = ["node-server"],
    crush = ["node-server"],
    opencode = ["node-server"],
  },
}
