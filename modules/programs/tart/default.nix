{
  delib,
  homeConfig,
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
    logDir = "${homeConfig.xdg.cacheHome}/tart";
    bootTimeout = 120;

    mkSshProxy = vmName:
      pkgs.writeShellScript "${vmName}-ssh-proxy" ''
        set -eu

        tart=${lib.getExe cfg.package}
        name=${lib.escapeShellArg vmName}

        if [ "$("$tart" get "$name" --format json | ${lib.getExe pkgs.jq} -r '.Running')" != "true" ]; then
          mkdir -p ${lib.escapeShellArg logDir}
          nohup "$tart" run --no-graphics "$name" \
            </dev/null >>${lib.escapeShellArg "${logDir}/${vmName}.log"} 2>&1 &
        fi

        ip="$("$tart" ip "$name" --wait ${toString bootTimeout})"
        exec ${lib.getExe pkgs.socat} STDIO "TCP-CONNECT:$ip:$1"
      '';

    mkSshSettings = vmName: vm: let
      base = {
        User = vm.sshUser;
        IdentityFile = vm.identityFile;
        IdentitiesOnly = true;
        ForwardAgent = true;
        ProxyCommand = "${mkSshProxy vmName} %p";
      };
    in {
      "${vmName}-raw" = base;
      ${vmName} =
        base
        // {
          RequestTTY = "yes";
          RemoteCommand = "exec tmux new-session -A -s main";
        };
    };
  in {
    home.packages = [cfg.package];

    programs.ssh.settings = lib.concatMapAttrs mkSshSettings cfg.vms;
  };
}
