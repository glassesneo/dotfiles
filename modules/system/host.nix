{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "system.host";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  darwin.always.networking = {
    hostName = host.name;
    computerName = host.name;
  };

  nixos.always.networking.hostName = host.name;

  darwin.ifEnabled = {myconfig, ...}: {
    system = {
      defaults = {
        smb.NetBIOSName = myconfig.constants.username;
        loginwindow.SHOWFULLNAME = true; # show full name in login window
      };
      startup.chime = false;
    };
  };
}
