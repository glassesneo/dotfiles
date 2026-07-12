{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nixvim";

  home.ifEnabled = {
    cfg,
    myconfig,
    ...
  }: let
    colors = myconfig.colorscheme;
    transparentGroups =
      [
        "Normal"
        "NormalNC"
        "SignColumn"
        "EndOfBuffer"
        "LineNr"
        "CursorLineNr"
        "Folded"
        "FoldColumn"
        "StatusLine"
        "StatusLineNC"
      ]
      ++ lib.optionals cfg.appearance.transparent-floats ["NormalFloat" "VertSplit"];
  in {
    programs.nixvim = lib.mkMerge [
      {
        colorschemes =
          if cfg.appearance.theme == "catppuccin"
          then {
            catppuccin = {
              enable = true;
              settings = {
                flavor = cfg.appearance.catppuccin-flavor;
                transparent_background = cfg.appearance.transparent;
                term_colors = true;
                integrations = {
                  dashboard = true;
                  fidget = true;
                  gitsigns = true;
                  navic = {
                    enabled = true;
                    custom_bg = "NONE";
                  };
                  notify = true;
                  treesitter = true;
                };
              };
              lazyLoad.enable = true;
            };
          }
          else if cfg.appearance.theme == "everforest"
          then {
            everforest = {
              enable = true;
              settings = {
                background = cfg.appearance.everforest-background;
                transparent_background = 2;
              };
              lazyLoad.enable = true;
            };
          }
          else {
            base16 = {
              enable = true;
              colorscheme = lib.filterAttrs (name: _: lib.hasPrefix "base" name) colors;
              settings.telescope = true;
            };
          };
        opts.winborder = lib.mkIf cfg.appearance.rounded-borders (lib.mkForce "rounded");
        highlight =
          lib.optionalAttrs (cfg.appearance.comment-color != "") {Comment.fg = cfg.appearance.comment-color;}
          // lib.optionalAttrs (cfg.appearance.theme == "catppuccin" && cfg.appearance.transparent) {
            FloatBorder = {
              fg = colors.base03;
              bg = "none";
            };
            FloatTitle = {
              fg = colors.base0E;
              bg = "none";
            };
            FloatShadow.bg = "none";
            FloatShadowThrough.bg = "none";
            NormalFloat.bg = colors.base01;
            Pmenu = {
              bg = colors.base01;
              fg = colors.base05;
            };
            PmenuSel = {
              bg = colors.base02;
              fg = colors.base06;
            };
            WinSeparator.fg = colors.base03;
          }
          // lib.optionalAttrs (cfg.appearance.transparent && cfg.appearance.theme != "catppuccin")
          (lib.genAttrs transparentGroups (_: {bg = "none";}));
        autoCmd = lib.optional cfg.appearance.transparent {
          event = ["ColorScheme" "VimEnter"];
          pattern = ["*"];
          once = false;
          callback.__raw = ''
            function()
              local transparent = { ${lib.concatMapStringsSep ", " (group: ''"${group}"'') transparentGroups} }
              for _, group in ipairs(transparent) do
                vim.api.nvim_set_hl(0, group, { bg = "none" })
              end
              ${lib.optionalString (cfg.appearance.theme == "catppuccin") ''
              vim.api.nvim_set_hl(0, "NormalFloat", { bg = "${colors.base01}" })
              vim.api.nvim_set_hl(0, "FloatBorder", { fg = "${colors.base03}", bg = "none" })
              vim.api.nvim_set_hl(0, "FloatTitle", { fg = "${colors.base0E}", bg = "none" })
              vim.api.nvim_set_hl(0, "FloatShadow", { bg = "none" })
              vim.api.nvim_set_hl(0, "FloatShadowThrough", { bg = "none" })
              vim.api.nvim_set_hl(0, "Pmenu", { fg = "${colors.base05}", bg = "${colors.base01}" })
              vim.api.nvim_set_hl(0, "PmenuSel", { fg = "${colors.base06}", bg = "${colors.base02}" })
              vim.api.nvim_set_hl(0, "VertSplit", { fg = "${colors.base03}", bg = "none" })
              vim.api.nvim_set_hl(0, "WinSeparator", { fg = "${colors.base03}", bg = "none" })
            ''}
            end
          '';
        };
      }
      {
        extraConfigLuaPost = builtins.readFile ./extra_config.lua;
        opts = {
          helplang = ["en"];
          number = true;
          # relativenumber = true;
          cursorcolumn = true;
          signcolumn = "yes";
          list = true;
          cmdheight = 0;
          # winblend = 5;
          # pumblend = 0;
          winborder = lib.mkDefault "bold";
          termguicolors = true;
          wildoptions = "pum";
          laststatus = 1;
          showcmd = true;
          # background = "dark";
          ruler = true;
          showtabline = 1;
          hlsearch = true;
          ignorecase = true;
          smartcase = true;
          incsearch = true;
          foldenable = false;
          wrap = true;
          confirm = true;
          hidden = true;
          autoread = true;
          autoindent = true;
          smartindent = true;
          clipboard = "unnamed";
          completeopt = ["menuone" "noinsert"];
          wildmenu = true;
          timeout = true;
          timeoutlen = 300;
          tabstop = 2;
          softtabstop = 2;
          shiftwidth = 2;
          expandtab = true;
        };
        diagnostic.settings = {
          severity_sort = true;
          float = {
            border = lib.mkDefault "none";
            # title = "Diagnostics";
            header = {};
            suffix = {};
            format.__raw = ''
              function(diag)
                if diag.code then
                  return string.format("[%s](%s): %s", diag.message, diag.source, diag.code)
                else
                  return string.format("[%s]: %s", diag.message, diag.source)
                end
              end
            '';
          };
          virtual_text = {
            format.__raw = ''
              function(diag)
                return string.format("%s (%s: %s)", diag.message, diag.source, diag.code)
              end
            '';
          };
          # virtual_lines = {
          # current_line = true;
          # };
          underline = true;
        };
        performance = {
          byteCompileLua = {
            configs = true;
            initLua = true;
            luaLib = true;
            nvimRuntime = true;
            plugins = true;
          };
        };
      }
    ];
  };
}
