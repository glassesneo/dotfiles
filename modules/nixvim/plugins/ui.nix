{
  plugins = {
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
    noice = {
      enable = true;
      settings = {
        messages.enabled = false;
        notify.enabled = false;
        lsp = {
          hover.enabled = false;
          signature.enabled = false;
        };
      };
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
  };
}
