return require("codecompanion.adapters").extend("gemini_cli", {
  defaults = {
    auth_method = "gemini-api-key", -- "oauth-personal"|"gemini-api-key"|"vertex-ai"
  },
  env = {
    GEMINI_API_KEY = "GEMINI_API_KEY",
  },
  commands = {
    default = {
      "gemini",
      "--experimental-acp",
    },
  },
})
