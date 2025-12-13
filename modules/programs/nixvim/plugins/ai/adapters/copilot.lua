return require("codecompanion.adapters").extend("copilot", {
  schema = {
    model = {
      default = "gpt-5.1",
      -- default = "claude-sonnet-4",
    },
    max_tokens = {
      default = 512000,
    },
  },
})
