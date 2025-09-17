return require("codecompanion.adapters").extend("openai_compatible", {
  name = "cerebras",
  formatted_name = "Cerebras",
  roles = {
    llm = "assistant",
    user = "user",
  },
  opts = {
    stream = true,
  },
  features = {
    text = true,
    tokens = true,
    vision = false,
  },
  env = {
    api_key = "CEREBRAS_API_KEY",
    url = "https://api.cerebras.ai",
  },
  schema = {
    model = {
      default = "gpt-oss-120b",
      choices = {
        "gpt-oss-120b",
        "qwen-3-coder-480b",
        "llama-4-maverick-17b-128e-instruct",
      },
    },
  },
})

