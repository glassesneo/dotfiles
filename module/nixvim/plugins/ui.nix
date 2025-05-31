{
  plugins = {
    dashboard = {
      # enable = true;
      settings.theme = "doom";
    };
    fidget = {
      enable = true;
      settings = {
        notification = {
          poll_rate = 10;
          filter = "info";
          override_vim_notify = false;
        };
      };
    };
    noice = {
      # enable = true;
      settings = {
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
        messages.enabled = false;
        notify.enabled = true;
        popupmenu.enabled = false;
      };
    };
    notify = {
      enable = true;
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
}
