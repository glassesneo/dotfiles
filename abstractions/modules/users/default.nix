{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "users";
  meta.description = "Apply the host's declared user information to OS user configuration.";

  darwin.always = {
    system.primaryUser = myconfig.host.user.name;
    users.users.${myconfig.host.user.name}.home = myconfig.host.user.homeDirectory;
  };
})
