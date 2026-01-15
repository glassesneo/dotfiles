{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.blink-cmp";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    lazyLoadSettings = {
      event = [
        "InsertEnter"
        "CmdlineEnter"
      ];
      before.__raw = ''
        function()
          -- Load orgmode if we're in an org file to ensure completion provider is available
          if vim.bo.filetype == "org" then
            require("lz.n").trigger_load('orgmode.nvim')
          end
        end
      '';
    };
  in {
    programs.nixvim = {
      plugins = {
        blink-cmp = {
          enable = true;
          setupLspCapabilities = true;
          lazyLoad = {
            enable = true;
            settings = lazyLoadSettings;
          };
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
              sources.__raw = ''
                function()
                  local type = vim.fn.getcmdtype()
                  if type == '/' or type == '?' then return { 'buffer' } end
                  if type == ':' or type == '@' then return { 'cmdline' } end
                  return {}
                end
              '';
            };
            sources = let
              commonSources = [
                "path"
                "buffer"
                "ripgrep"
                "copilot"
                "snippets"
                "git"
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
                org = ["orgmode"];
              };
              providers = {
                buffer = {
                  score_offset = -3;
                };
                copilot = {
                  async = true;
                  module = "blink-cmp-copilot";
                  name = "copilot";
                  score_offset = 3;
                };
                git = {
                  module = "blink-cmp-git";
                  name = "git";
                };
                ripgrep = {
                  module = "blink-ripgrep";
                  name = "ripgrep";
                };
                lsp = {
                  fallbacks = [];
                  score_offset = 3;
                };
                cmdline = {
                  # min_keyword_length.__raw = ''
                  # function(ctx)
                  # if ctx.mode == "cmdline" and ctx.line:find("^%l+$") ~= nil then
                  # return 3
                  # end
                  # return 0
                  # end
                  # '';
                };
                orgmode = {
                  module = "orgmode.org.autocompletion.blink";
                  name = "orgmode";
                  fallbacks = ["buffer"];
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
        blink-cmp-copilot = {
          enable = true;
          lazyLoad = {
            enable = true;
            settings =
              lazyLoadSettings
              // {
                before.__raw = ''
                  function()
                    require("lz.n").trigger_load('copilot.lua')
                  end
                '';
              };
          };
        };
        blink-cmp-git = {
          enable = true;
          lazyLoad = {
            enable = true;
            settings = lazyLoadSettings;
          };
        };
        blink-ripgrep = {
          enable = true;
          lazyLoad = {
            enable = true;
            settings = lazyLoadSettings;
          };
        };
        blink-compat = {
          enable = true;
          lazyLoad = {
            enable = true;
            settings = lazyLoadSettings;
          };
        };
        luasnip = {
          enable = true;
          lazyLoad = {
            enable = true;
            settings = lazyLoadSettings;
          };
        };
        friendly-snippets = {
          enable = true;
        };
      };
      dependencies = {
        ripgrep.enable = true;
      };
    };
  };
}
