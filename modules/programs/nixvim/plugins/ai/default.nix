{
  delib,
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
            adapters.http = {
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
