{
  pkgs,
  inputs,
  ...
}: let
  mcp-hub = inputs.mcp-hub.packages."aarch64-darwin".default;
  mcphub-nvim = inputs.mcphub-nvim.packages."aarch64-darwin".default;
in {
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
          copilot.__raw = ''
            function()
              return require("codecompanion.adapters").extend("copilot", {
                schema = {
                  model = {
                    -- default = "claude-3.7-sonnet",
                    default = "gpt-4.1",
                  },
                },
              })
            end
          '';
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
                      "gpt-4o",
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
        extensions = {
          history = {
            enabled = true;
            opts = {
              auto_generate_title = true;
            };
          };
          mcphub = {
            callback = "mcphub.extensions.codecompanion";
            opts = {
              show_result_in_chat = true;
              make_vars = true;
              make_slash_commands = true;
              requires_approval = true;
            };
          };
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
  extraPlugins = [
    pkgs.vimPlugins.codecompanion-history-nvim
    pkgs.vimPlugins.plenary-nvim
    mcphub-nvim
  ];
  extraConfigLua = ''
    -- Set up mcphub.nvim with explicit mcp-hub path if needed
    require("mcphub").setup({
      cmd = "${mcp-hub}/bin/mcp-hub"
    })
  '';
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
      action = "CodeCompanion";
      key = "CC";
      mode = ["ca"];
      options = {
        silent = true;
      };
    }
  ];
}
