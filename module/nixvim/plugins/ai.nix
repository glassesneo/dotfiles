{
  pkgs,
  inputs,
  lib,
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
                    default = "gpt-4.1",
                    -- default = "claude-sonnet-4",
                  },
                  max_tokens = {
                    default = 512000,
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
            tools = {
              opts = {
                auto_submit_errors = true;
                auto_submit_success = true;
              };
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
      lazyLoad = {
        enable = true;
        settings = {
          cmd = [
            "CodeCompanion"
            "CodeCompanionChat"
          ];
          before.__raw = ''
            function()
              require("lz.n").trigger_load("mcphub")

              require("mcphub").setup({
                auto_approve = function(params)
                  local allowed_servers = {
                    context7 = true,
                    ["brave-search"] = true,
                    deepwiki = true,
                    ["sequential-thinking"] = true,
                    readability = true,
                  }
                  if allowed_servers[params.server_name] then
                    return true
                  end

                  local allowed_filesystem_tools = {
                    directory_tree = true,
                    get_file_info = true,
                    list_allowed_directories = true,
                    list_directory = true,
                    read_file = true,
                    read_multiple_files = true,
                    search_files = true,
                  }

                  if params.server_name == "filesystem" and allowed_filesystem_tools[params.tool_name] then
                    return true
                  end

                  local allowed_neovim_tools = {
                    list_directory = true,
                    read_file = true,
                  }

                  if params.server_name == "neovim" and allowed_neovim_tools[params.tool_name] then
                    return true
                  end

                  local allowed_memory_tools = {
                    read_graph = true,
                  }

                  if params.server_name == "memory" and allowed_memory_tools[params.tool_name] then
                    return true
                  end

                  if params.server_name == "mcphub" and params.tool_name == "get_current_servers" then
                    return true
                  end

                  return false
                end,
                cmd = "${lib.getExe' mcp-hub "mcp-hub"}"
              })
            end
          '';
        };
      };
    };
  };
  extraPlugins = [
    pkgs.vimPlugins.codecompanion-history-nvim
    pkgs.vimPlugins.plenary-nvim
    mcphub-nvim
  ];
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
