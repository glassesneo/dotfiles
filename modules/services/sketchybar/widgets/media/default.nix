{
  delib,
  homeConfig,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "services.sketchybar.widget-media";

  options = with delib;
    moduleOptions ({parent, ...}: let
      name = "media";
      nushellBin = lib.getExe parent.nushellPackage;
      enabled =
        parent.enable
        && lib.any (section: lib.any (entry: entry.widget == name) parent.layout.${section}) parent.sections;
      handler = pkgs.replaceVars ./handler.nu {
        inherit name;
      };
      script = pkgs.writeShellScript "script" ''
        exec ${nushellBin} ${handler}
      '';
    in {
      enable = boolOption enabled;
      render = readOnly (packageOption (pkgs.replaceVars ./widget.nu {
        inherit name;
        script-path = script;
      }));
    });

  myconfig.ifEnabled = {
    programs.media-control.enable = true;
  };

  home.ifEnabled = {parent, ...}: let
    service = ./service.nu;
  in {
    launchd.agents.media-control = {
      enable = true;
      config = {
        Label = "media-control";
        ProgramArguments = [
          "${pkgs.writeShellScript "service" ''
            exec ${lib.getExe parent.nushellPackage} ${service}
          ''}"
        ];
        EnvironmentVariables = {
          PATH = "/Users/neo/.nix-profile/bin:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin";
        };
        KeepAlive = true;
        StandardOutPath = "${homeConfig.xdg.stateHome}/media-control/stdout.log";
        StandardErrorPath = "${homeConfig.xdg.stateHome}/media-control/stderr.log";
      };
    };
  };
}
