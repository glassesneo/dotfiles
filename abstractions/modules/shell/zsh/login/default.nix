{delib, ...}:
delib.module {
  name = "zsh.login";
  meta.description = "Configure the behavior required to use Zsh as a login shell.";

  options.enable = delib.boolOption false;

  hjem.ifEnabled = {config, ...}: {
    zsh.zshenv.hjem-environment.text = ''
      if [ -z "''${__HJEM_ENV_LOADED-}" ]; then
        export __HJEM_ENV_LOADED=1
        . ${config.environment.loadEnv}
      fi
    '';
  };
}
