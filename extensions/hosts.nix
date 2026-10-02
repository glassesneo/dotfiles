{
  delib,
  lib,
  config,
  ...
}: let
  inherit (config) host;
in {
  settings.hosts.extraSubmodules = {config, ...}: let
    isDarwin = (lib.systems.elaborate config.system).isDarwin;
    userNames = builtins.attrNames config.users;
  in
    with delib; {
      options = {
        system = description strOption "Nix system of this host.";

        users =
          description
          (attrsOfOption (submodule ({name, ...}: {
            options = {
              homeDirectory =
                description
                (strOption (
                  if isDarwin
                  then "/Users/${name}"
                  else "/home/${name}"
                ))
                "Home directory of this user on the host.";
            };
          })) {})
          "Users on this host. Each user receives its own Hjem configuration.";

        primaryUser =
          description
          (allowNull (enumOption userNames (
            if builtins.length userNames == 1
            then builtins.head userNames
            else null
          )))
          "User that owns per-user system settings. Defaults to the only user when exactly one is declared.";
      };
    };

  imports = [
    (delib.module {
      name = "host";

      options = with delib; {
        name = readOnly (strOption host.name);
        system = readOnly (strOption host.system);
        users = readOnly (attrsOption host.users);
        primaryUser = readOnly (allowNull (strOption host.primaryUser));
      };
    })
  ];
}
