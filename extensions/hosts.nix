# Owns the host attributes: system, users, and primary user.
# `flake.nix` publishes configurations from these attributes; the host module
# exposes them to other modules through the read-only view `myconfig.host`.
{
  delib,
  lib,
  ...
}: {
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

              fullName =
                description
                (allowNull (strOption null))
                "Full name of this user, such as the author name of their commits.";

              email =
                description
                (allowNull (strOption null))
                "Email address of this user, such as the author address of their commits.";
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
}
