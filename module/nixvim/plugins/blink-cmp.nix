{
  pkgs,
  lib,
  ...
}: let
  cmp-skkeleton = pkgs.vimUtils.buildVimPlugin rec {
    name = "cmp-skkeleton";
    src = pkgs.fetchFromGitHub {
      owner = "uga-rosa";
      repo = name;
      rev = "2c268a407e9e843abd03c6fa77485541a4ddcd9a";
      hash = "sha256-Odg0cmLML2L4YVcrMt7Lrie1BAl7aNEq6xqJN3/JhZs=";
    };
  };
  cmp-cmdline-history = pkgs.vimUtils.buildVimPlugin rec {
    name = "cmp-cmdline-history";
    src = pkgs.fetchFromGitHub {
      owner = "dmitmel";
      repo = name;
      rev = "003573b72d4635ce636234a826fa8c4ba2895ffe";
      hash = "sha256-IcruTOCNxYKmbo0St1U+CmrDStASPLe+rTLNU6/2Xew=";
    };
  };
in {
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
          sources.__raw = ''
            function()
              local type = vim.fn.getcmdtype()
              if type == '/' or type == '?' then return { 'buffer' } end
              if type == ':' or type == '@' then return { 'cmdline', 'cmdline_history' } end
              return {}
            end
          '';
        };
        sources = let
          commonSources = [
            "path"
            "buffer"
            "copilot"
            "snippets"
            "git"
            "skkeleton"
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
            cmdline_history = {
              module = "blink.compat.source";
              name = "cmdline_history";
            };
            git = {
              module = "blink-cmp-git";
              name = "git";
            };
            skkeleton = {
              module = "blink.compat.source";
              name = "skkeleton";
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
  extraPlugins = [
    cmp-skkeleton
    cmp-cmdline-history
  ];
}
