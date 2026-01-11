return require("codecompanion.adapters").extend("copilot", {
  schema = {
    max_tokens = {
      default = 512000,
    },
  },
})
