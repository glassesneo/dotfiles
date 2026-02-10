{
  delib,
  nixvimConventions,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.ui";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      dashboard = {
        # enable = true;
        settings.theme = "doom";
      };
      fidget = {
        enable = true;
        lazyLoad = {
          enable = true;
          settings = {
            event = [
              "LspAttach"
            ];
          };
        };
        settings = {
          notification = {
            poll_rate = 10;
            filter = "info";
            override_vim_notify = false;
          };
        };
      };
      noice = {
        enable = true;
        settings = {
          # routes = [
          # {
          # filter = {
          # find = "--------------. -\n: $";
          # };
          # view = "popup";
          # }
          # ];
          views = {
            mini = {
              timeout = 5000;
            };
            notify = {
              timeout = 5000;
            };
          };
          presets = {
            inc_rename = nixvimConventions.capabilities.hasIncRename;
          };
          cmdline = {
            enabled = true;
          };
          health.checker = false;
          lsp = {
            hover.enabled = false;
            message.enabled = false;
            progress.enabled = false;
            signature.enabled = false;
          };
          messages = {
            enabled = true;
            # view = "messages";
            view_warn = "mini";
          };
          notify.enabled = true;
          popupmenu.enabled = false;
        };
      };
      notify = {
        # enable = true;
        settings = {
          stages = "slide";
          max_width = 50;
          timeout = 1800;
        };
        luaConfig.post = ''
          vim.notify = require("notify")
        '';
      };
      # scrollview = {
      # enable = true;
      # settings = {
      # execluded_filetypes = [
      # "ddu-ff"
      # "ddu-filer"
      # ];
      # };
      # };
    };
  };
}
