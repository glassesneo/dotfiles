{
  delib,
  host,
  inputs,
  pkgs,
  ...
}:
delib.module {
  name = "services.kanata";

  options.services.kanata = with delib; {
    enable = boolOption host.guiShellFeatured;
  };

  darwin.always = {
    imports = [
      inputs.kanata-darwin.darwinModules.default
    ];
  };

  darwin.ifEnabled = {
    services.kanata = {
      enable = true;
      package = pkgs.kanata-with-cmd;
      configSource = ./kanata.kbd;
      # With sudoers enabled, kanata starts without a login-time auth prompt.
      # Keep .kbd free of cmd actions unless you intentionally want root-triggered commands.
      sudoers = true;
      daemon.enable = false;
      kanata-bar = {
        enable = true;
        settings = {
          kanata = {
            path = "${pkgs.kanata-with-cmd}/bin/kanata";
            port = 5829;
            extra_args = ["--nodelay"];
          };
          kanata_bar = {
            autostart_kanata = true;
            autorestart_kanata = true;
          };
        };
        extraLaunchdConfig = {
          KeepAlive = {
            SuccessfulExit = false;
          };
          ProcessType = "Interactive";
          ThrottleInterval = 5;
          StandardOutPath = "/tmp/kanata-bar.log";
          StandardErrorPath = "/tmp/kanata-bar.err";
        };
      };
    };
  };
}
