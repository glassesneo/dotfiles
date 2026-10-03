{delib, ...}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "zsh.login";

  options = with delib; {
    enable = boolOption (myconfig.shell.loginShell == "zsh");
    package = packageOption myconfig.zsh.package;
  };

  darwin.ifEnabled = {
    environment = {
      shells = [cfg.package];
    };
  };

  hjem.ifEnabled = {config, ...}: {
    zsh.zshenv.hjem-environment.text = ''
      if [ -z "''${__HJEM_ENV_LOADED-}" ]; then
        export __HJEM_ENV_LOADED=1
        . ${config.environment.loadEnv}
      fi
    '';
  };
})
