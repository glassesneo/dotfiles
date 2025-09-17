return require("codecompanion.adapters").extend("ollama", {
  schema = {
    model = {
      default = "deepseek-r1:1.5b",
    },
  },
})

