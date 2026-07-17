{
  delib,
  host,
  lib,
  pkgs,
  tiers,
  ...
}:
delib.module {
  name = "programs.tart";

  options = with delib;
    moduleOptions ({myconfig, ...}: {
      enable = boolOption (pkgs.stdenv.isDarwin && tiers.atLeast host.tier "standard");
      package = packageOption pkgs.tart;
      vms = attrsOfOption (submodule {
        options = {
          os = noDefault (enumOption ["linux" "darwin"] null);
          sshUser = strOption myconfig.constants.username;
          identityFile = strOption myconfig.programs.ssh.mainIdentity;
        };
      }) {};
    });

  home.ifEnabled = {cfg, ...}: let
    mkSshProxy = vmName:
      pkgs.writeShellScript "${vmName}-ssh-proxy" ''
        ip="$(${lib.getExe cfg.package} ip ${lib.escapeShellArg vmName})"
        exec ${lib.getExe pkgs.socat} STDIO "TCP-CONNECT:$ip:$1"
      '';
  in {
    home.packages = [cfg.package];

    programs.ssh.settings =
      lib.mapAttrs (vmName: vm: {
        User = vm.sshUser;
        IdentityFile = vm.identityFile;
        IdentitiesOnly = true;
        ForwardAgent = true;
        ProxyCommand = "${mkSshProxy vmName} %p";
      })
      cfg.vms;
  };
}
