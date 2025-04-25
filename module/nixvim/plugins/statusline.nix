{
  plugins = {
    lualine = {
      enable = true;
      settings = {
        options = {
          globalstatus = true;
          # component_separators = {
          # left = "";
          # right = "";
          # };
        };
        sections = {
          lualine_c = [
            {
              __unkeyed-1 = "filename";
              path = 1;
              shorting_target = 30;
              symbols = {
                modified = "_";
                readonly = " ";
                newfile = "🆕 ";
              };
            }
          ];
        };
        winbar = {
          lualine_a = [
            {
              __unkeyed-1 = "diagnostics";

              sources = ["nvim_diagnostic" "nvim_lsp"];
              sections = ["error" "warn" "info" "hint"];
              symbols = {
                error = " ";
                warn = " ";
                info = " ";
                hint = " ";
              };
            }
          ];
          lualine_b = [];
          lualine_c = [
            {
              __unkeyed-1 = "navic";
              draw_empty = true;
            }
          ];
          lualine_x = [];
          lualine_z = [];
        };
        inactive_winbar = {
          lualine_a = [
            {
              __unkeyed-1 = "diagnostics";

              sources = ["nvim_diagnostic" "nvim_lsp"];
              sections = ["error" "warn" "info" "hint"];
              symbols = {
                error = " ";
                warn = " ";
                info = " ";
                hint = " ";
              };
            }
          ];
          lualine_b = [];
          lualine_c = [];
          lualine_x = [];
          lualine_z = [];
        };
      };
      luaConfig.post = ''
        vim.opt.showmode = false
      '';
    };
    navic = {
      enable = true;
      settings = {
        lsp = {
          auto_attach = true;
        };
        highlight = true;
        depth_limit = 9;
        icons = {
          File = "󰈙 ";
          Module = " ";
          Namespace = "󰌗 ";
          Package = " ";
          Class = "󰠱 ";
          Method = "󰆧 ";
          Property = " ";
          Field = " ";
          Constructor = " ";
          Enum = " ";
          Interface = " ";
          Function = "󰊕 ";
          Variable = "󰀫 ";
          Constant = "󰏿 ";
          String = "󰀬 ";
          Number = "󰎠 ";
          Boolean = "◩ ";
          Array = "󰅪 ";
          Object = "󰅩 ";
          Key = "󰌋 ";
          Null = "󰟢 ";
          EnumMember = " ";
          Struct = "󰙅 ";
          Event = " ";
          Operator = "󰆕 ";
          TypeParameter = " ";
        };
      };
    };
    bufferline = {
      enable = true;
      settings = {
        highlights.__raw = ''
          require("catppuccin.groups.integrations.bufferline").get()
        '';
        options = {
          themable = true;
          buffer_close_icon = "";
          close_icon = "";
          diagnostics = "nvim_lsp";
        };
      };
    };
  };
}
