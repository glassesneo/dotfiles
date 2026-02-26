{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.snacks";

  options = delib.singleEnableOption true;

  home.ifEnabled = {myconfig, ...}: {
    programs.nixvim = {
      plugins.snacks = {
        enable = true;
        settings = {
          styles = {
            notification = {
              border = "rounded";
            };
          };
          bigfile.enabled = false;
          bufdelete.enable = true;
          notifier = {
            enabled = true;
          };
          quickfile.enabled = false;
          statuscolumn.enabled = false;
          explorer = {
            enabled = true;
            replace_netrw = true;
          };
          words.enabled = false;
          input = {
            enabled = true;
            win = {
              border = "rounded";
              b.completion = true;
            };
          };
          indent = {
            enabled = true;
            animate.enabled = false;
            only_scope = true;
            scope = {
              enabled = true;
              only_current = true;
            };
            chunk = {
              enabled = false;
              only_current = true;
            };
          };
          picker = let
            finderLayout = {
              cycle = true;
              col = 0.45;
              height = 0.5;
              row = -2;
              width = 0.98;
              position = "float";
            };
          in {
            enabled = true;
            win = {
              input.border = "rounded";
              list.border = "solid";
              preview.border = "rounded";
              backdrop = {
                transparent = true;
                # blend = 20;
              };
            };
            sources = let
              ignore_paths = lib.genAttrs myconfig.programs.git.ignore_names (_: false);
            in {
              smart = {
                layout.layout = finderLayout;
                ignored = true;
                filter.paths = ignore_paths;
                hidden = true;
              };
              grep = {
                layout.layout = finderLayout;
                ignored = true;
                filter.paths = ignore_paths;
                hidden = true;
              };
              lsp_symbols = {
                layout.layout = finderLayout;
              };
              explorer = {
                layout = {
                  layout = {
                    box = "vertical";
                    position = "left";
                  };
                };
                git_untracked = true;
                ignored = true;
                hidden = true;
              };
            };
          };
        };
      };
      keymaps =
        [
          {
            action.__raw = "Snacks.bufdelete.delete";
            key = "<Space><CR>";
          }
          {
            action.__raw = "Snacks.picker.smart";
            key = "<Space><Space>";
          }
          {
            action.__raw = "Snacks.picker.grep";
            key = "<Space>g";
          }
        ]
        ++ [
          {
            action.__raw = "Snacks.picker.pickers";
            key = "<Space><C-p>";
          }
          {
            action.__raw = "Snacks.picker.command_history";
            key = "<Space>pc";
          }
          {
            action.__raw = "Snacks.picker.lsp_symbols";
            key = "<Space><C-l>";
          }
          {
            action.__raw = "Snacks.picker.explorer";
            key = "<Space>f";
          }
        ];
    };
  };
}
