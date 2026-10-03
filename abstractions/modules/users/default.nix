{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "users";
  meta.description = "Apply the host's declared user information to OS user configuration.";

  darwin.always = {
    system.primaryUser = lib.mkIf (myconfig.host.primaryUser != null) myconfig.host.primaryUser;
    users.users = builtins.mapAttrs (_: user: {home = user.homeDirectory;}) myconfig.host.users;
  };
})
