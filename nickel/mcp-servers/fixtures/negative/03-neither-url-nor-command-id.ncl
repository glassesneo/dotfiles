let validate = import "../../validate.ncl" in

validate {
  servers = {
    incomplete-server = {},
  },

  enabled = {
    mcphub = ["incomplete-server"],
    claude_code = ["incomplete-server"],
    claude_desktop = ["incomplete-server"],
    codex = ["incomplete-server"],
    crush = ["incomplete-server"],
    opencode = ["incomplete-server"],
  },
}
