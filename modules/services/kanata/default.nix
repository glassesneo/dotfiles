{
  delib,
  host,
  inputs,
  lib,
  pkgs,
  ...
}: let
  profiles = {
    macbook-us = ./macbook-us.kbd;
  };
in
  delib.module {
    name = "services.kanata";

    options = with delib;
      moduleOptions {
        enable = boolOption host.guiShellFeatured;
        profile = lib.mkOption {
          type = lib.types.nullOr (lib.types.enum (builtins.attrNames profiles));
          default = null;
        };
      };

    darwin.always = {
      imports = [
        inputs.kanata-darwin.darwinModules.default
      ];
    };

    darwin.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      selectedProfile = cfg.profile;
      profileSet = selectedProfile != null;
      riftEnabled = myconfig.services.rift.enable;
      riftExtension =
        if riftEnabled
        then
          pkgs.replaceVars ./rift.kbd {
            riftCli = "${myconfig.services.rift.package}/bin/rift-cli";
          }
        else pkgs.writeText "kanata-rift-disabled.kbd" "";
      effectiveConfigSource = pkgs.writeText "${selectedProfile}-generated.kbd" (
        builtins.replaceStrings
        [
          "  ;; @rift-src-h@\n"
          "  ;; @rift-src-lmet@\n"
          "  ;; @rift-base-h@\n"
          "  ;; @rift-base-lmet@\n"
          "  @cmd-right-default\n"
          "  chords-v2-min-idle 5\n"
          ";; @rift-include@\n"
        ]
        [
          (lib.optionalString riftEnabled "  h\n")
          (lib.optionalString riftEnabled "  lmet\n")
          (lib.optionalString riftEnabled "  h\n")
          (lib.optionalString riftEnabled "  @rift-lmet\n")
          (lib.optionalString riftEnabled "  @rift-rmet\n")
          "  chords-v2-min-idle 5\n${lib.optionalString riftEnabled "  danger-enable-cmd yes\n"}"
          "(include \"${riftExtension}\")\n"
        ]
        (builtins.readFile profiles.${selectedProfile})
      );
    in {
      assertions = [
        {
          assertion = selectedProfile != null;
          message = "services.kanata is enabled but myconfig.kanata.profile is not set for host ${host.name}";
        }
      ];

      services.kanata =
        {
          enable = profileSet;
          package = pkgs.kanata-with-cmd;
          # With sudoers enabled, kanata starts without a login-time auth prompt.
          # Keep .kbd free of cmd actions unless you intentionally want root-triggered commands.
          sudoers = true;
          daemon.enable = false;
          kanata-bar = {
            enable = true;
            settings = {
              kanata = {
                path = "${pkgs.kanata-with-cmd}/bin/kanata";
                port = 5829;
                extra_args = ["--nodelay"];
              };
              kanata_bar = {
                autostart_kanata = true;
                autorestart_kanata = true;
              };
            };
            extraLaunchdConfig = {
              KeepAlive = {
                SuccessfulExit = false;
              };
              ProcessType = "Interactive";
              ThrottleInterval = 5;
              StandardOutPath = "/tmp/kanata-bar.log";
              StandardErrorPath = "/tmp/kanata-bar.err";
            };
          };
        }
        // lib.optionalAttrs (selectedProfile != null) {
          configSource = effectiveConfigSource;
        };
    };
  }
