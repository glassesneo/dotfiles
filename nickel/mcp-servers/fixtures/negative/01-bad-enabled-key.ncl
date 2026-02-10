let validate = import "../../validate.ncl" in

validate {
  servers = {
    valid-server = {
      command_id = "valid-server-cmd",
    },
  },

  enabled = {
    mcphub = ["missing-server"],
    claude_code = ["valid-server"],
    claude_desktop = ["valid-server"],
    codex = ["valid-server"],
    crush = ["valid-server"],
    opencode = ["valid-server"],
  },
}
