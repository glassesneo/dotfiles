{delib, ...}:
delib.host {
  name = "seiran-vm1";
  type = "virtual";
  rice = "monochrome";
  tier = "standard";

  myconfig = {
    darwin.window-manager.enable = false;
    programs.tart.enable = false;
    services = {
      aerospace.enable = false;
      kanata = {
        enable = false;
        profile = null;
      };
      rift.enable = false;
      sketchybar.enable = false;
    };
    user.uid = 501;
  };

  darwin = {
    services.openssh = {
      enable = true;
      extraConfig = ''
        AuthorizedKeysFile none
        PasswordAuthentication no
        KbdInteractiveAuthentication no
        PermitRootLogin no
      '';
    };

    users.users.neo.openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC43jV/scFhyOWFlrpv4jDxn5Ef002X+wh56oUP4SZzK glassesneo@protonmail.com"
    ];
  };
}
