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
      config = ./profiles/macbook-us.kbd;
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
      selectedProfileConfig = profiles.${selectedProfile}.config;
      # Keep injections declarative so future tool integrations can add one
      # entry here and reuse the same root-config assembly flow. Injections may
      # add layers and request a startup-selected base layer, but the profile
      # owns the canonical defsrc/base structure.
      injections = [
        {
          name = "rift";
          enabled = myconfig.services.rift.enable;
          startupBaseLayer = "rift-base";
          rootFragment = pkgs.replaceVars ./injections/rift.kbd {
            riftCli = "${myconfig.services.rift.package}/bin/rift-cli";
          };
        }
      ];
      enabledInjections = lib.filter (injection: injection.enabled) injections;
      enabledStartupBaseLayers = lib.unique (
        lib.filter (layer: layer != null) (
          map (injection: injection.startupBaseLayer or null) enabledInjections
        )
      );
      selectedStartupBaseLayer =
        if enabledStartupBaseLayers == []
        then null
        else builtins.head enabledStartupBaseLayers;
      startupLayerFragment =
        if selectedStartupBaseLayer == null
        then null
        else pkgs.writeText "${selectedProfile}-startup-layer.kbd" ''
          (defalias
            kanata-init-layer (layer-switch ${selectedStartupBaseLayer})
          )
        '';
      includedFragments =
        [
          ./common.kbd
          selectedProfileConfig
        ]
        ++ map (injection: injection.rootFragment) (
          lib.filter (injection: injection.rootFragment != null) enabledInjections
        )
        ++ lib.optional (startupLayerFragment != null) startupLayerFragment;
      effectiveConfigSource =
        pkgs.writeText "${selectedProfile}-generated.kbd"
        (lib.concatLines (
          [
            "(defcfg"
            "  process-unmapped-keys yes"
            # Keep the canonical profile base as the first defined layer so
            # sparse injection overlays can transparently inherit it.
            "  delegate-to-first-layer yes"
            "  concurrent-tap-hold yes"
            "  chords-v2-min-idle 5"
            "  danger-enable-cmd yes"
          ]
          ++ lib.optional (selectedStartupBaseLayer != null) "  alias-to-trigger-on-load kanata-init-layer"
          ++ [
            ")"
          ]
          ++ map include includedFragments
        ));
    in {
      assertions = [
        {
          assertion = builtins.length enabledStartupBaseLayers <= 1;
          message = "services.kanata profile ${selectedProfile} has multiple injection startup base layers enabled at once: ${lib.concatStringsSep ", " enabledStartupBaseLayers}";
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
