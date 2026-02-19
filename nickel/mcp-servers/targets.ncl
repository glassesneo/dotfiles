# Target adapter metadata consumed by the Nix MCP adapter.
# This keeps target formatting policy in Nickel data instead of Nix branches.
{
  target_list = [
    "claude_code",
    "claude_desktop",
    "codex",
    "opencode",
  ],

  targets_meta = {
    claude_code = {
      env_syntax_mode = "dollar_braces",
      env_field_name = "env",
      static_env_field_name = "env",
      url_type_policy = "sse",
      local_type_policy = null,
      command_list_behavior = false,
    },

    claude_desktop = {
      env_syntax_mode = "dollar_braces",
      env_field_name = "env",
      static_env_field_name = "env",
      url_type_policy = "sse",
      local_type_policy = null,
      command_list_behavior = false,
    },

    codex = {
      env_syntax_mode = "raw",
      env_field_name = "env_vars",
      static_env_field_name = "env",
      url_type_policy = null,
      local_type_policy = null,
      command_list_behavior = false,
    },

    opencode = {
      env_syntax_mode = "braces_env_colon",
      env_field_name = "environment",
      static_env_field_name = "environment",
      url_type_policy = "remote",
      local_type_policy = "local",
      command_list_behavior = true,
    },
  },
}
