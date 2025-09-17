{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.editing";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      inc-rename = {
        enable = false;
        lazyLoad = {
          enable = true;
          settings = {
            event = [
              "LspAttach"
            ];
          };
        };
      };
      nvim-surround = {
        enable = true;
        lazyLoad = {
          enable = true;
          settings = {
            event = [
              "BufRead"
              "BufNewFile"
            ];
          };
        };
      };
      ts-comments = {
        enable = true;
        settings = {
          lang = {
            elm = "-- %s";
            lua = "-- %s";
            nim = "# %s";
            nix = "# %s";
            nu = "# %s";
            typst = "// %s";
            zig = "// %s";
          };
        };
        lazyLoad = {
          enable = true;
          settings = {
            event = [
              "BufRead"
              "BufNewFile"
            ];
          };
        };
      };
      ts-autotag = {
        enable = true;
        lazyLoad = {
          enable = true;
          settings = {
            event = ["InsertEnter"];
          };
        };
        settings = {
          opts = {
            enable_close = true;
            enable_close_on_slash = false;
            enable_rename = true;
          };
        };
      };
      ts-context-commentstring = {
        # enable = true;
        extraOptions = {
          enable_autocmd = false;
        };
        languages = {
          elm = "-- %s";
          nim = "# %s";
          nu = "# %s";
          typst = "// %s";
          v = "// %s";
          zig = "// %s";
        };
      };
      autoclose = {
        enable = true;
        settings.options = {
          auto_indent = true;
          keys = {
            "|" = {
              close = true;
              escape = true;
              pair = "||";
              enabled_filetypes = ["zig"];
              disable_command_mode = true;
            };
          };
        };
        lazyLoad = {
          enable = true;
          settings = {
            event = [
              "InsertEnter"
              "CmdlineEnter"
            ];
          };
        };
      };
    };
  };
}
