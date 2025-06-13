{lib, ...}: {
  plugins = {
    blink-cmp = {
      enable = true;
      setupLspCapabilities = true;
      settings = {
        appearance = {
          nerd_font_variant = "normal";
        };
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
          };
          menu = {
            border = "none";
            draw = {
              columns = [
                {
                  __unkeyed-1 = "kind_icon";
                }
                {
                  __unkeyed-1 = "label";
                  __unkeyed-2 = "label_description";
                }
                {
                  __unkeyed-1 = "source_name";
                }
              ];
              treesitter = ["lsp"];
            };
          };
          list.selection = {
            auto_insert = false;
          };
        };
        signature = {
          enabled = true;
        };
        snippets.preset = "luasnip";
        cmdline = {
          enabled = true;
          keymap = {
            preset = "inherit";
            "<CR>" = [
              "accept_and_enter"
              "fallback"
            ];
          };
          completion = {
            list.selection.preselect = false;
            menu = {
              auto_show = true;
            };
            ghost_text = {enabled = true;};
          };
        };
        sources = let
          commonSources = [
            "path"
            "buffer"
            "copilot"
            "snippets"
          ];
          commonLangSources = ["lsp"] ++ commonSources;
          forJapanese = lib.lists.remove "buffer" commonLangSources;
        in {
          default = commonLangSources;
          per_filetype = {
            markdown = forJapanese;
            mdx = forJapanese;
            typst = forJapanese;
            codecompanion = ["codecompanion"];
          };
          providers = {
            buffer = {
              score_offset = -3;
            };
            copilot = {
              async = true;
              module = "blink-cmp-copilot";
              name = "copilot";
              score_offset = 5;
            };
            lsp = {
              fallbacks = [];
            };
            cmdline = {
              min_keyword_length.__raw = ''
                function(ctx)
                  if ctx.mode == "cmdline" and ctx.line:find("^%l+$") ~= nil then
                    return 3
                  end
                  return 0
                end
              '';
            };
          };
        };
        keymap = {
          preset = "super-tab";
          "<C-b>" = [
            "scroll_documentation_up"
            "fallback"
          ];
          "<C-f>" = [
            "scroll_documentation_down"
            "fallback"
          ];
          "<C-n>" = [
            "select_next"
            "fallback"
          ];
          "<C-p>" = [
            "select_prev"
            "fallback"
          ];
          "<C-space>" = [
            "show"
            "show_documentation"
            "hide_documentation"
          ];
          "<C-y>" = [
            "select_and_accept"
          ];
          "<S-Tab>" = [
            "snippet_backward"
            "fallback"
          ];
          "<Tab>" = [
            "snippet_forward"
            "fallback"
          ];
        };
      };
    };
    blink-cmp-copilot.enable = true;
    blink-cmp-git.enable = true;
    blink-compat = {
      enable = true;
    };
    luasnip = {
      enable = true;
    };
    friendly-snippets = {
      enable = true;
    };
  };
}
