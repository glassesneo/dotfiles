{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf.autocomplete";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf.settings.vim = {
      autocomplete.blink-cmp = {
        enable = true;
        setupOpts = let
          withFallback = action: [
            action
            "fallback"
          ];
        in {
          completion = {
            accept = {
              auto_brackets = {
                enabled = true;
                semantic_token_resolution = {
                  enabled = true;
                };
              };
            };
            documentation = {
              auto_show = true;
              auto_show_delay_ms = 150;
            };
            list.selection = {
              auto_insert = false;
            };
            menu = {
              draw = {
                columns = [
                  ["kind_icon"]
                  ["label" "label_description" "source_name"]
                ];
                treesitter = ["lsp"];
              };
            };
          };
          keymap = {
            preset = "super-tab";
            "<C-e>" = withFallback (lib.generators.mkLuaInline ''
              function(cmp)
                cmp.hide()
                if vim.lsp.inline_completion.get() then
                  return true
                end
              end
            '');
            "<C-b>" = withFallback "scroll_documentation_up";
            "<C-f>" = withFallback "scroll_documentation_down";
            "<C-n>" = withFallback "select_next";
            "<C-p>" = withFallback "select_prev";
            "<Tab>" = withFallback "snippet_forward";
            "<S-Tab>" = withFallback "snippet_backward";
            "<C-y>" = [
              "select_and_accept"
            ];
          };
          cmdline = {
            completion = {
              list.selection.preselect = false;
              menu.auto_show = true;
              ghost_text = {enabled = true;};
            };
            keymap = {
              preset = "inherit";
              "<CR>" = withFallback "accept_and_enter";
            };
            sources = [
              "cmdline"
              "buffer"
            ];
          };
        };
        friendly-snippets = {
          enable = true;
        };
      };
    };
  };
}
