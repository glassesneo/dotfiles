{
  nixvimLib,
  delib,
  homeConfig,
  host,
  inputs,
  lib,
  nodePkgs,
  pkgs,
  ...
}: let
  mcp-hub = inputs.mcp-hub.packages."${host.homeManagerSystem}".default;
  mcphub-nvim = inputs.mcphub-nvim.packages."${host.homeManagerSystem}".default;
  nodejs = pkgs.lib.getExe pkgs.nodejs;
  readability-mcp = "${nodePkgs."@mizchi/readability"}/lib/node_modules/@mizchi/readability/dist/mcp.js";
  brave-search-mcp = pkgs.lib.getExe' nodePkgs."@brave/brave-search-mcp-server" "brave-search-mcp-server";
  tavily-mcp = pkgs.lib.getExe' nodePkgs."tavily-mcp" "tavily-mcp";

  # Convert MCP servers to ACP format
  # ACP expects: { name: string, command: string, args?: string[], env?: {name: string, value: string}[] }[]
  acpMcpServers = [
    # {
    # name = "brave-search";
    # command = brave-search-mcp;
    # args = [];
    # env = [
    # {
    # name = "BRAVE_API_KEY";
    # value = "\${BRAVE_API_KEY}";
    # }
    # ];
    # }
    {
      name = "readability";
      command = nodejs;
      args = [readability-mcp];
      env = [];
    }
    # {
    # name = "tavily";
    # command = tavily-mcp;
    # args = [];
    # env = [
    # {
    # name = "TAVILY_API_KEY";
    # value = "\${TAVILY_API_KEY}";
    # }
    # ];
    # }
  ];
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
          lazyLoad = {
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
                {
                  __unkeyed-1 = "CC";
                  mode = ["ca"];
                  __unkeyed-3 = "CodeCompanion";
                }
              ];
              before.__raw = ''
                function()
                  ${builtins.readFile
                  <| pkgs.replaceVars ./codecompanion-preload.lua {
                    mcp-hub-exe = lib.getExe' mcp-hub "mcp-hub";
                  }}
                end
              '';
            };
          };
          settings = {
            adapters = {
              http = {
                copilot.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/copilot.lua}
                  end
                '';
                gemini.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/gemini.lua}
                  end
                '';
                ollama.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/ollama.lua}
                  end
                '';
                cerebras.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/cerebras.lua}
                  end
                '';
                io-intelligence.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/io-intelligence.lua}
                  end
                '';
                ai-mop-openai.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/ai-mop-openai.lua}
                  end
                '';
                ai-mop-anthropic.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/ai-mop-anthropic.lua}
                  end
                '';
              };
              acp = {
                claude_code.__raw = ''
                  function()
                    ${builtins.readFile
                    <| pkgs.replaceVars ./adapters/claude-code.lua {
                      command = lib.getExe' nodePkgs."@zed-industries/claude-code-acp" "claude-code-acp";
                      # mcpServers = nixvimLib.nixvim.toLuaObject acpMcpServers;
                    }}
                  end
                '';
                gemini_cli.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/gemini-cli.lua}
                  end
                '';
              };
            };
            extensions = {
              history = {
                enabled = true;
                opts = {
                  auto_generate_title = true;
                  title_generation_opts = {
                    adapter = "copilot";
                    model = "gpt-4.1";
                  };
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
                      if adapter.type == "http" then
                        if adapter.parameters == nil then
                          model_name = adapter.schema.model.default
                        else
                          model_name = adapter.schema.model.default
                        end
                        return "  CodeCompanion (" .. adapter.formatted_name .. " - " .. model_name .. ")"
                      elseif adapter.type == "acp" then
                        return "  " .. adapter.formatted_name .. " via ACP"
                      end
                      return "  CodeCompanion"
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
                  width = 0.425;
                };
                auto_scroll = true;
                show_header_separator = true;
                fold_context = true;
                fold_reasoning = true;
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
