{
  delib,
  host,
  inputs,
  lib,
  pkgs,
  ...
}: let
  mcp-hub = inputs.mcp-hub.packages."${host.homeManagerSystem}".default;
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
                {
                  __unkeyed-1 = "CCA";
                  mode = ["ca"];
                  __unkeyed-3 = "CodeCompanionActions";
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
                        return "  CodeCompanion (" .. adapter.formatted_name .. " - " .. model_name .. ")"
                      elseif adapter.type == "acp" then
                        return "  " .. adapter.formatted_name .. " via ACP"
                      end
                      return "  CodeCompanion"
                    end
                  '';
                  user = "  Me";
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
    };
  }
