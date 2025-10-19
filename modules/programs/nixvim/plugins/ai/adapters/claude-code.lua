return require("codecompanion.adapters").extend("claude_code", {
  defaults = {},
  env = {
    CLAUDE_CODE_OAUTH_TOKEN = "CLAUDE_CODE_OAUTH_TOKEN",
  },
  commands = {
    default = {
      "@command@",
    },
  },
})
