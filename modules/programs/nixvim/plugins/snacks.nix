{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.snacks";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins.snacks = {
      enable = true;
      settings = {
        bigfile.enabled = false;
        bufdelete.enable = true;
        notifier = {
          enabled = true;
          style = "compact";
        };
        quickfile.enabled = false;
        statuscolumn.enabled = false;
        explorer = {
          enabled = true;
          replace_netrw = true;
        };
        words.enabled = false;
        input.enabled = true;
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
          sources = {
            smart = {
              layout.layout = finderLayout;
            };
            grep = {
              layout.layout = finderLayout;
            };
            lsp_symbols = {
              layout.layout = finderLayout;
            };
            explorer = {
              layout = {
                layout = {
                  position = "left";
                };
              };
            };
          };
        };
      };
    };
    keymaps = [
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
}
