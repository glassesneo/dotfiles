{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.lualine";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      lualine = {
        enable = true;
        settings = {
          options = {
            globalstatus = true;
            component_separators = {
              left = "";
              right = "";
            };
            section_separators = {
              left = "";
              right = "";
            };
          };
          sections = {
            lualine_a = [
              "branch"
            ];
            lualine_b = [
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
            lualine_c = [
              {
                __unkeyed-1 = "'%='";
                separator = "";
              }
              {
                __unkeyed-1 = "diff";
                symbols = {
                  added = " ";
                  modified = " ";
                  removed = " ";
                };
                separator = " | ";
              }
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
                separator = " | ";
              }
            ];
            lualine_x = ["encoding" "fileformat"];
            lualine_y = [
              {
                __unkeyed-1 = "filetype";
                separator = "|";
              }
              {
                __unkeyed-1.__raw = ''
                  function()
                    ${builtins.readFile ./mcphub/init.lua}
                  end
                '';
                color.__raw = ''
                  function()
                    ${builtins.readFile ./mcphub/color.lua}
                  end
                '';
              }
            ];
            lualine_z = [];
          };
        };
        luaConfig.post = ''
          vim.opt.showmode = false
        '';
      };
      navic = {
        enable = true;
        lazyLoad = {
          enable = true;
          settings = {
            event = ["LspAttach"];
          };
        };
        settings = {
          lsp = {
            auto_attach = true;
            preference = ["nil"];
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
    };
  };
}
