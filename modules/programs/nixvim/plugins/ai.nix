{
  delib,
  homeConfig,
  host,
  inputs,
  lib,
  pkgs,
  ...
}: let
  mcp-hub = inputs.mcp-hub.packages."${host.homeManagerSystem}".default;
  mcphub-nvim = inputs.mcphub-nvim.packages."${host.homeManagerSystem}".default;
in
  delib.module {
    name = "programs.nixvim.plugins.ai";

    options = delib.singleEnableOption true;

    home.ifEnabled.programs.nixvim = {
      plugins = {
        copilot-lua = {
          enable = true;
          settings = {
            panel.enabled = false;
            suggestion.enabled = false;
          };
          lazyLoad = {
            enable = true;
            settings = {
              cmd = ["InsertEnter"];
            };
          };
        };
        codecompanion = {
          enable = true;
          lazyLoad = let
            load-fzf-lua = lib.optionalString homeConfig.programs.nixvim.plugins.fzf-lua.enable ''
              require('lz.n').trigger_load('fzf-lua')
            '';
            load-blink-cmp-provider = lib.optionalString homeConfig.programs.nixvim.plugins.blink-cmp.enable ''
              require('lz.n').trigger_load('blink.cmp')
              local blink = require("blink.cmp")
              blink.add_source_provider("codecompanion", {
                name = "CodeCompanion",
                module = "codecompanion.providers.completion.blink",
                enabled = true,
              })
            '';
          in {
            enable = true;
            settings = {
              cmd = [
                "CodeCompanion"
                "CodeCompanionChat"
              ];
              keys = [
                {
                  __unkeyed-1 = "<Space>c";
                  mode = ["n"];
                  __unkeyed-3 = "<Cmd>CodeCompanionChat Toggle<CR>";
                }
              ];
              before.__raw = ''
                function()
                  require("lz.n").trigger_load("codecompanion-history.nvim")

                  ${load-fzf-lua}
                  ${load-blink-cmp-provider}

                  require("lz.n").trigger_load("mcphub")

                  require("mcphub").setup({
                    auto_approve = function(params)
                      local allowed_servers = {
                        context7 = true,
                        ["brave-search"] = true,
                        deepwiki = true,
                        ["sequential-thinking"] = true,
                        readability = true,
                        tavily = true,
                        time = true,
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
                      api_key = "GEMINI_API_KEY",
                    },
                  })
                end
              '';
              ollama.__raw = ''
                function()
                  return require("codecompanion.adapters").extend("ollama", {
                    schema = {
                      model = {
                        default = "deepseek-r1:1.5b",
                      },
                    },
                  })
                end
              '';
              huggingface.__raw = ''
                function()
                  return require("codecompanion.adapters").extend("huggingface", {
                    env = {
                      api_key = "HF_INFERENCE_API_KEY",
                    },
                    schema = {
                      model = {
                        default = "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B",
                        choices = {
                          "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B",
                          "Qwen/Qwen3-Coder-480B-A35B-Instruct",
                          "google/gemma-2-2b-it",
                        },
                      },
                    },
                  })
                end
              '';
              cerebras.__raw = ''
                function()
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
                      url = "https://api.cerebras.ai"
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
                end
              '';
              io_intelligence.__raw = ''
                function()
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
                      url = "https://api.intelligence.io.solutions/api"
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
                end
              '';
              ai_mop_openai.__raw = ''
                function()
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
                    }
                  })
                end
              '';
              ai_mop_anthropic.__raw = ''
                function()
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
                          "claude-3-5-sonnet-latest"
                        },
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
        };
      };
      extraPlugins = [
        {
          plugin = pkgs.vimPlugins.codecompanion-history-nvim;
          optional = true;
        }
        mcphub-nvim
      ];

      extraConfigLua = ''
        require('lz.n').load({{
          'codecompanion-history.nvim',
        }})
      '';
    };
  }
