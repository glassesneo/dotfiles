{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf.snacks";
  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {myconfig, ...}: let
    # Snacks path filters use false values to reject matching path segments.
    ignoredPaths = lib.genAttrs myconfig.programs.git.ignore_names (_: false);
    pickerLayout = {
      cycle = true;
      col = 0.45;
      height = 0.5;
      row = -2;
      width = 0.98;
      position = "float";
    };
  in {
    programs.nvf.settings.vim = {
      utility.snacks-nvim = {
        enable = true;
        setupOpts = {
          bigfile.enabled = false;
          bufdelete.enabled = true;
          explorer = {
            enabled = true;
            replace_netrw = true;
          };
          indent = {
            enabled = true;
            animate.enabled = false;
            only_scope = true;
            scope = {
              enabled = true;
              only_current = true;
            };
            chunk.enabled = false;
          };
          input.enabled = false;
          notifier.enabled = false;
          picker = {
            enabled = true;
            sources = {
              smart = {
                hidden = true;
                ignored = true;
                filter.paths = ignoredPaths;
                layout.layout = pickerLayout;
              };
              grep = {
                hidden = true;
                ignored = true;
                filter.paths = ignoredPaths;
                layout.layout = pickerLayout;
              };
              explorer = {
                hidden = true;
                ignored = true;
                git_untracked = true;
                filter.paths = ignoredPaths;
                layout.layout = {
                  box = "vertical";
                  position = "left";
                };
              };
            };
          };
          quickfile.enabled = false;
          statuscolumn.enabled = false;
          words.enabled = false;
          zen.enabled = true;
        };
      };

      keymaps = [
        {
          key = "<Space><Space>";
          mode = ["n"];
          action = "function() Snacks.picker.smart() end";
          lua = true;
          desc = "Find files";
        }
        {
          key = "<Space>g";
          mode = ["n"];
          action = "function() Snacks.picker.grep() end";
          lua = true;
          desc = "Grep files";
        }
        {
          key = "<Space>f";
          mode = ["n"];
          action = "function() Snacks.picker.explorer() end";
          lua = true;
          desc = "File explorer";
        }
        {
          key = "<Space><CR>";
          mode = ["n"];
          action = "function() Snacks.bufdelete.delete() end";
          lua = true;
          desc = "Delete buffer";
        }
        {
          key = "<Space>z";
          mode = ["n"];
          action = "function() Snacks.zen() end";
          lua = true;
          desc = "Zen mode";
        }
      ];
    };
  };
}
