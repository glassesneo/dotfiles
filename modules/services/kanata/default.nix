{
  delib,
  host,
  inputs,
  lib,
  pkgs,
  ...
}: let
  profiles = {
    macbook-us = {
      base = ./profiles/macbook-us/base.kbd;
      variants = {
        rift = ./profiles/macbook-us/variants/rift.kbd;
      };
    };
  };
in
  delib.module {
    name = "services.kanata";

    options = with delib;
      moduleOptions ({myconfig, ...}: {
        enable = boolOption (
          host.guiShellFeatured
          && myconfig.services.kanata.profile != null
        );
        profile = lib.mkOption {
          type = lib.types.nullOr (lib.types.enum (builtins.attrNames profiles));
          default = null;
        };
      });

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
      include = path: "(include \"${path}\")";
      selectedProfileFiles = profiles.${selectedProfile};
      # Keep injections declarative so future tool integrations can add one
      # entry here and reuse the same root-config assembly flow.
      injections = [
        {
          name = "rift";
          enabled = myconfig.services.rift.enable;
          profileVariant = "rift";
          rootFragment = pkgs.replaceVars ./injections/rift.kbd {
            riftCli = "${myconfig.services.rift.package}/bin/rift-cli";
          };
        }
      ];
      enabledInjections = lib.filter (injection: injection.enabled) injections;
      enabledProfileVariants = lib.unique (
        lib.filter (variant: variant != null) (
          map (injection: injection.profileVariant or null) enabledInjections
        )
      );
      missingProfileVariants =
        lib.filter (
          variant: !(builtins.hasAttr variant selectedProfileFiles.variants)
        )
        enabledProfileVariants;
      selectedProfileConfig =
        if enabledProfileVariants == []
        then selectedProfileFiles.base
        else selectedProfileFiles.variants.${builtins.head enabledProfileVariants};
      includedFragments =
        [
          ./common.kbd
          selectedProfileConfig
        ]
        ++ map (injection: injection.rootFragment) (
          lib.filter (injection: injection.rootFragment != null) enabledInjections
        );
      effectiveConfigSource =
        pkgs.writeText "${selectedProfile}-generated.kbd"
        (lib.concatLines (
          [
            "(defcfg"
            "  process-unmapped-keys yes"
            "  concurrent-tap-hold yes"
            "  chords-v2-min-idle 5"
            "  danger-enable-cmd yes"
            ")"
          ]
          ++ map include includedFragments
        ));
    in {
      assertions = [
        {
          assertion = builtins.length enabledProfileVariants <= 1;
          message = "services.kanata profile ${selectedProfile} has multiple injection profile variants enabled at once: ${lib.concatStringsSep ", " enabledProfileVariants}";
        }
        {
          assertion = missingProfileVariants == [];
          message = "services.kanata profile ${selectedProfile} is missing profile variants for injections: ${lib.concatStringsSep ", " missingProfileVariants}";
        }
      ];
      services.kanata =
        {
          enable = true;
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
        // {
          configSource = effectiveConfigSource;
        };
    };
  }
