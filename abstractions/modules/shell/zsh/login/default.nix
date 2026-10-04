{delib, ...}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "zsh.login";
  meta.description = "Configure the behavior required to use Zsh as a login shell.";

  options = with delib; {
    enable = boolOption false;
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
