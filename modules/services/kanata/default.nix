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

    darwin.ifEnabled = {cfg, ...}: let
      selectedProfile = cfg.profile;
      profileSet = selectedProfile != null;
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
          configSource = profiles.${selectedProfile};
        };
    };
  }
