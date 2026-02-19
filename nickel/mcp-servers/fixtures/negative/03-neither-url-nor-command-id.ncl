let validate = import "../../validate.ncl" in

validate {
  servers = {
    incomplete-server = {},
  },

  enabled = {
    claude_code = ["incomplete-server"],
    claude_desktop = ["incomplete-server"],
    codex = ["incomplete-server"],
    opencode = ["incomplete-server"],
  },
}
