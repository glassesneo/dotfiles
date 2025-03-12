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
        };
      };
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
