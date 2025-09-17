return require("codecompanion.adapters").extend("anthropic", {
  name = "ai_mop/anthropic",
  formatted_name = "AI-MOP/Anthropic",
  roles = {
    llm = "assistant",
    user = "user",
  },
  opts = {
    cache_breakpoints = 4,
    cache_over = 300,
    stream = true,
    tools = false,
    vision = false,
  },
  features = {
    text = true,
    tokens = true,
  },
  url = "https://api.anthropic.iniad.org/api/v1/messages",
  env = {
    api_key = "AI_MOP_API_KEY",
  },
  schema = {
    model = {
      default = "claude-3-7-sonnet-latest",
      choices = {
        "claude-sonnet-4-0",
        "claude-3-7-sonnet-latest",
        "claude-3-5-sonnet-latest",
      },
    },
  },
})

