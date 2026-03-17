{delib, ...}:
delib.module {
  name = "nix-darwin.system.host";

  options = delib.singleEnableOption true;

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
