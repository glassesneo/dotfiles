return require("codecompanion.adapters").extend("openai_compatible", {
  name = "io_intelligence",
  formatted_name = "IO Intelligence",
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
    api_key = "IO_INTELLIGENCE_API_KEY",
    url = "https://api.intelligence.io.solutions/api",
  },
  schema = {
    model = {
      default = "openai/gpt-oss-20b",
      choices = {
        "openai/gpt-oss-120b",
        "deepseek-ai/DeepSeek-R1-0528",
        "Intel/Qwen3-Coder-480B-A35B-Instruct-int4-mixed-ar",
        "Qwen/Qwen3-235B-A22B-Thinking-2507",
      },
    },
  },
})

