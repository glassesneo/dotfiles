export const openai_base_url = "https://api.openai.iniad.org/api/v1"
export const anthropic_base_url = "https://api.anthropic.iniad.org/api/v1"

export module openai {
  export def models []: nothing -> record {
    let result = http get --allow-errors -H {Authorization: $"Bearer ($env.AI_MOP_API_KEY)"} $"($openai_base_url)/models"
    return $result
  }

  export def chat [model: string = "gpt-5-nano"]: string -> record {
    let body = {model: $model, messages: [{role: user, content: $in}]}
    let result = http post --allow-errors -H {Authorization: $"Bearer ($env.AI_MOP_API_KEY)"} --content-type "application/json" $"($openai_base_url)/chat/completions" $body
    return $result
  }
}

export module anthropic {
  export def model [model: string]: nothing -> record {
    let result = http get --allow-errors -H {x-api-key: $env.AI_MOP_API_KEY} $"($anthropic_base_url)/models/($model)"
    return $result
  }

  export def chat [model: string = "claude-3-7-sonnet-latest"]: string -> record {
    let body = {model: $model, max_tokens: 1024, messages: [{role: user, content: $in}], tools: [{ type: web_search_20250305, name: web_search, max_uses: 5 }]}
    let result = http post --allow-errors -H {x-api-key: $env.AI_MOP_API_KEY} --content-type "application/json" $"($anthropic_base_url)/messages" $body
    return $result
  }
}
