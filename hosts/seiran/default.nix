{
  delib,
  lib,
  pkgs,
  ...
}:
delib.host {
  name = "seiran";
  type = "laptop";
  rice = "catppuccin";
  tier = "full";
  hasNotch = true;
  myconfig.services.kanata.profile = "macbook-us";
  myconfig.darwin.window-manager.backend = lib.mkForce "rift";
  myconfig.programs.appcleaner.enable = true;
  myconfig.user.uid = 501;

  home = {myconfig, ...}: {
    programs.ssh = {
      settings = {
        "seiran-vm1" = let
          tart = lib.getExe myconfig.programs.tart.package;
          socat = lib.getExe pkgs.socat;
          seiranVm1Proxy = pkgs.writeShellScript "seiran-vm1-ssh-proxy" ''
            ip="$(${tart} ip seiran-vm1)"
            exec ${socat} STDIO "TCP-CONNECT:$ip:$1"
          '';
        in {
          User = "neo";
          IdentityFile = myconfig.programs.ssh.mainIdentity;
          IdentitiesOnly = true;
          ForwardAgent = true;

          ProxyCommand = "${seiranVm1Proxy} %p";
        };
      };
    };
  };
}
