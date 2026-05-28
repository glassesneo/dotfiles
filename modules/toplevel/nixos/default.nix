{
  delib,
  host,
  ...
}:
delib.module {
  name = "nixos";

  nixos.always = {myconfig, ...}: {
    services.dbus.implementation = "broker";
    environment = {
      variables = {
        LC_ALL = "en_US.UTF-8";
      };
    };

    networking = {
      hostName = host.name;
    };

    nix = {
      gc = {
        automatic = true;
        options = "--delete-older-than 3d";
      };

      optimise = {
        automatic = true;
      };
    };
  };
}
