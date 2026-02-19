let validate = import "../../validate.ncl" in

validate {
  servers = {
    valid-server = {
      command_id = "valid-server-cmd",
    },
  },

  enabled = {
    claude_code = ["valid-server"],
    claude_desktop = ["valid-server"],
    codex = ["valid-server"],
    opencode = ["valid-server"],
  },
}
