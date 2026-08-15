{
  delib,
  host,
  inputs,
  lib,
  pkgs,
  ...
}: let
  integrationType = lib.types.submodule {
    options = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether to include this external-software integration.";
      };
      fragment = lib.mkOption {
        type = lib.types.path;
        description = "Kanata fragment owned by the integrated software.";
      };
      startupBaseLayer = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Optional sparse base layer selected when this integration is enabled.";
      };
    };
  };
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
        profile = allowNull (enumOption (builtins.attrNames profiles) null);
        integrations = attrsOfOption integrationType {};
      });

    darwin.always = {
      imports = [
        inputs.kanata-darwin.darwinModules.default
      ];
    };

    darwin.ifEnabled = {cfg, ...}: let
      selectedProfile = cfg.profile;
      include = path: "(include \"${path}\")";
      selectedProfileConfig = profiles.${selectedProfile}.config;
      enabledIntegrationNames = lib.filter (
        name: cfg.integrations.${name}.enable
      ) (builtins.attrNames cfg.integrations);
      enabledIntegrations =
        map (
          name: cfg.integrations.${name}
        )
        enabledIntegrationNames;
      enabledStartupBaseLayers = lib.unique (
        lib.filter (layer: layer != null) (
          map (integration: integration.startupBaseLayer) enabledIntegrations
        )
      );
      selectedStartupBaseLayer =
        if enabledStartupBaseLayers == []
        then null
        else builtins.head enabledStartupBaseLayers;
      startupLayerFragment =
        if selectedStartupBaseLayer == null
        then null
        else
          pkgs.writeText "${selectedProfile}-startup-layer.kbd" ''
            (defalias
              kanata-init-layer (layer-switch ${selectedStartupBaseLayer})
            )
          '';
      includedFragments =
        [
          ./common.kbd
          selectedProfileConfig
        ]
        ++ map (integration: integration.fragment) enabledIntegrations
        ++ lib.optional (startupLayerFragment != null) startupLayerFragment;
      effectiveConfigSource =
        pkgs.writeText "${selectedProfile}-generated.kbd"
        (lib.concatLines (
          [
            "(defcfg"
            "  process-unmapped-keys yes"
            "  log-layer-changes no"
            # Keep the canonical profile base as the first defined layer so
            # sparse integration overlays can transparently inherit it.
            "  delegate-to-first-layer yes"
            "  concurrent-tap-hold yes"
            "  chords-v2-min-idle 5"
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
          message = "services.kanata profile ${selectedProfile} has multiple integration startup base layers enabled at once: ${lib.concatStringsSep ", " enabledStartupBaseLayers}";
        }
      ];
      services.kanata =
        {
          enable = true;
          package = pkgs.kanata-with-cmd;
          # With sudoers enabled, kanata starts without a login-time auth prompt.
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
