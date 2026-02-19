let validate = import "../../validate.ncl" in

validate {
  servers = {
    dual-server = {
      command_id = "dual-server-cmd",
      url = "https://example.invalid/mcp",
    },
  },

  enabled = {
    claude_code = ["dual-server"],
    claude_desktop = ["dual-server"],
    codex = ["dual-server"],
    opencode = ["dual-server"],
  },
}
