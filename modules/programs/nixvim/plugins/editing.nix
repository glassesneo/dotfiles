{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.editing";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
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
      ts-context-commentstring = {
        enable = true;
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
