{
  delib,
  lib,
  ...
}: let
  availableShells = ["zsh"];
in
  delib.module ({
    cfg,
    myconfig,
    myoptions,
    ...
  }: {
    name = "shell";
    meta.description = "Define a shared configuration interface for shells and configure the selected login shell.";

    options = with delib; {
      enable = boolOption true;
      loginShell = enumOption availableShells;
    };

    myconfig.ifEnabled =
      lib.genAttrs availableShells (shell: {
        login.enable = lib.mkDefault (
          myoptions.shell.loginShell.isDefined
          && cfg.loginShell == shell
          && myconfig.${shell}.enable
        );
      })
      // {
        assertions = [
          {
            assertion = builtins.length (lib.filter (shell: myconfig.${shell}.login.enable) availableShells) <= 1;
            message = "At most one login shell may be enabled: ${lib.concatStringsSep ", " availableShells}";
          }
        ];
      };

    darwin.ifEnabled = {
      users.users =
        builtins.mapAttrs
        (_: _: {
          ignoreShellProgramCheck = true;
          shell = myconfig.${cfg.loginShell}.package;
        })
        myconfig.host.users;
    };
  })
