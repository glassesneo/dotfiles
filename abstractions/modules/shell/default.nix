{delib, ...}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "shell";
  meta.description = "Define a shared configuration interface for shells and configure the selected login shell.";

  options = with delib; {
    enable = boolOption true;
    loginShell = strOption;
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
