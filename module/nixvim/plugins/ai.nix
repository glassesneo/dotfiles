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
        };
        strategies = {
          chat = {
            adapter = "copilot";
            roles = {
              llm.__raw = ''
                function(adapter)
                  return "  CodeCompanion (" .. adapter.formatted_name .. ")"
                end
              '';
              user = "  Me";
            };
          };
        };
        display = {
          chat = {
            auto_scroll = false;
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
