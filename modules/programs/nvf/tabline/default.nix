{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf.tabline";
  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf.settings.vim = {
      additionalRuntimePaths = [./runtime];
      luaConfigRC.nvf-tabline-areas = "require('nvf.tabline').setup()";
      tabline = {
        nvimBufferline = {
          enable = true;
          setupOpts = {
            options = {
              themable = true;
              buffer_close_icon = "";
              close_icon = "";
              separator_style = "thick";
              diagnostics = "nvim_lsp";
              custom_areas = {
                left = lib.generators.mkLuaInline "require('nvf.tabline').root_area";
                right = lib.generators.mkLuaInline "require('nvf.tabline').branch_area";
              };
            };
          };
        };
      };
      keymaps = [
        {
          key = "<S-h>";
          mode = ["n"];
          action = "<Cmd>BufferLineCyclePrev<CR>";
          silent = true;
        }
        {
          key = "<S-l>";
          mode = ["n"];
          action = "<Cmd>BufferLineCycleNext<CR>";
          silent = true;
        }
      ];
    };
  };
}
