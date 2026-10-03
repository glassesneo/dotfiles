{
  delib,
  config,
  ...
}: let
  inherit (config) host;
in
  delib.module {
    name = "host";
    meta.description = "Expose the selected host's information to modules and reflect its identity in OS host names.";

    options = with delib; {
      name = readOnly (strOption host.name);
      system = readOnly (strOption host.system);
      users = readOnly (attrsOption host.users);
      primaryUser = readOnly (allowNull (strOption host.primaryUser));
    };

    # Host-less operator commands resolve the selected host through `hostname -s`.
    darwin.always.networking = {
      hostName = host.name;
      computerName = host.name;
      localHostName = host.name;
    };
  }
