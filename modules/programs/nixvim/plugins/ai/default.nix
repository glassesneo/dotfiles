{delib, ...}:
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
        enable = false;
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
                ${builtins.readFile ./codecompanion-preload.lua}
              end
            '';
          };
        };
        settings = {
          strategies = {
            chat = {
              adapter = "copilot";
              roles = {
                llm = "  CodeCompanion";
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
