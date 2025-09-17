return require("codecompanion.adapters").extend("openai_compatible", {
  name = "ai_mop/openai",
  formatted_name = "AI-MOP/OpenAI",
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
    api_key = "AI_MOP_API_KEY",
    url = "https://api.openai.iniad.org/api",
  },
  schema = {
    model = {
      default = "gpt-4.1-nano",
      choices = {
        "gpt-4o",
        "o4-mini",
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-4.1-nano",
      },
      mapping = "parameters",
    },
  },
})

