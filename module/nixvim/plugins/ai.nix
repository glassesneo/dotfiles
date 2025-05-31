{
  plugins = {
    copilot-lua = {
      enable = true;
      settings = {
        panel.enabled = false;
        suggestion.enabled = false;
      };
    };
    codecompanion = {
      enable = true;
      settings = {
        adapters = {
          gemini.__raw = ''
            function()
              return require("codecompanion.adapters").extend("gemini", {
                env = {
                  api_key = "GEMINI_API_KEY";
                },
              })
            end
          '';
          ai_mop.__raw = ''
            function()
              return require("codecompanion.adapters").extend("openai_compatible", {
                name = "ai_mop",
                formatted_name = "AI MOP",
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
                      "o4-mini",
                      "gpt-4.1",
                      "gpt-4.1-mini",
                      "gpt-4.1-nano",
                    },
                    mapping = "parameters",
                  },
                }
              })
            end
          '';
        };
        opts = {
          log_level = "TRACE";
        };
        strategies = {
          chat = {
            adapter = "copilot";
            roles = {
              llm.__raw = ''
                function(adapter)
                  local model_name = ""
                  if adapter.parameters == nil then
                    model_name = adapter.schema.model.default
                  else
                    model_name = adapter.schema.model.default
                  end
                  return "  CodeCompanion (" .. adapter.formatted_name .. " - " .. model_name .. ")"
                end
              '';
              user = "  Me";
            };
          };
        };
        display = {
          chat = {
            window = {
              position = "right";
              width = 0.4;
            };
            auto_scroll = true;
            show_header_separator = true;
          };
        };
      };
    };
  };
  keymaps = [
    {
      action = "<Cmd>CodeCompanionChat Toggle<CR>";
      key = "<Leader>c";
      mode = ["n"];
      options = {
        silent = true;
      };
    }
    {
      action = "<Cmd>CodeCompanionChat Add<CR>";
      key = "<Leader>ca";
      mode = ["v"];
      options = {
        silent = true;
      };
    }
  ];
}
