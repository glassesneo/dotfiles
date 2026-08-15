{
  delib,
  homeConfig,
  host,
  inputs,
  lib,
  pkgs,
  windowManager,
  ...
}: let
  serviceLabel = "git.acsandmann.rift";
  normalOuterGap = 4;
  gapAssertions = cfg: [
    {
      assertion = cfg.reservedTop >= normalOuterGap;
      message = "services.rift.reservedTop must be at least the normal outer gap of ${toString normalOuterGap} logical points.";
    }
    {
      assertion = !host.hasNotch || cfg.reservedTop <= normalOuterGap || host.builtInDisplayUuid != null;
      message = "services.rift requires host.builtInDisplayUuid on notched hosts when reservedTop exceeds the normal outer gap.";
    }
  ];
  # Rift is a Rust-built tiling window manager for macOS. Packaging stays local
  # to this module because there is no other consumer yet; if more modules need
  # the package, lift it into modules/config/ with a shared option.
  rift = pkgs.rustPlatform.buildRustPackage {
    pname = "rift";
    version = inputs.rift.shortRev or inputs.rift.rev or "unstable";
    src = inputs.rift;
    cargoLock = {
      lockFile = "${inputs.rift}/Cargo.lock";
      # Hashes for upstream git-sourced crates. If the rift flake input is
      # bumped to a revision whose Cargo.lock rewrites either of these, the
      # build will fail fast with the expected hash; update accordingly.
      outputHashes = {
        "continue-0.1.1" = "sha256-8S+gPfz6CtzIKsGh9wg3CevMdNA9V+KOyHR9F9DlVcw=";
        "dispatchr-1.0.0" = "sha256-Df6PdDA5bpmy2P30vGdad+EiHJiANmHrRF2q75Uegik=";
      };
    };
    cargoBuildFlags = ["--bins"];
    buildInputs = lib.optionals pkgs.stdenv.isDarwin [
      pkgs.apple-sdk_15
    ];
    doCheck = false;
    meta = with lib; {
      description = "Tiling window manager for macOS (Rust)";
      homepage = "https://github.com/acsandmann/rift";
      platforms = platforms.darwin;
      mainProgram = "rift";
    };
  };
in
  delib.module {
    name = "services.rift";

    options = with delib;
      moduleOptions {
        # Activation is derived from the shared Window Manager selector.
        enable = readOnly (boolOption windowManager.isRift);
        package = readOnly (packageOption rift);
        reservedTop = description (intOption 38) "Total top outer gap for displays where SketchyBar occupies the top edge, in logical points.";
        # Rift owns the final upstream run_on_start value; integrations append
        # commands through this typed aggregation interface.
        startupCommands = listOfOption str [];
      };

    darwin.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: {
      myconfig.services.kanata.integrations.rift = {
        enable = true;
        fragment = ./kanata.kbd;
        startupBaseLayer = "rift-base";
      };

      # Rift requires macOS "Displays have separate Spaces" enabled (i.e.
      # com.apple.spaces.spans-displays = 0). That preference is owned by
      # system.spaces, which writes the key when enabled. This assertion guards
      # only the policy module's enable flag — it does not verify the final
      # key/value. If the module changes which key it writes, this check must be
      # tightened.
      assertions =
        [
          {
            assertion = myconfig.system.spaces.enable;
            message = "services.rift requires system.spaces.enable = true so that 'Displays have separate Spaces' (com.apple.spaces.spans-displays = 0) stays applied.";
          }
        ]
        ++ gapAssertions cfg;

      environment.systemPackages = [cfg.package];
    };

    home.ifEnabled = {cfg, ...}: let
      perDisplayOuter = lib.optionalString (host.hasNotch && host.builtInDisplayUuid != null) ''
        [settings.layout.gaps.per_display."${lib.toUpper host.builtInDisplayUuid}".outer]
        top = ${toString normalOuterGap}
        left = ${toString normalOuterGap}
        bottom = ${toString normalOuterGap}
        right = ${toString normalOuterGap}
      '';
      riftConfig = assert lib.all (check: lib.assertMsg check.assertion check.message) (gapAssertions cfg);
        pkgs.replaceVars ./config.toml {
          reservedTop = toString cfg.reservedTop;
          normalOuterGap = toString normalOuterGap;
          runOnStart = builtins.toJSON cfg.startupCommands;
          inherit perDisplayOuter;
        };
    in {
      home.packages = [cfg.package];

      xdg.configFile."rift/config.toml".source = riftConfig;

      launchd.agents.rift = {
        enable = true;
        config = {
          # Rift's `service` subcommand manages this fixed per-user launchd
          # label and plist path, so keep the generated service compatible with
          # `rift service restart`.
          Label = serviceLabel;
          ProgramArguments = [(lib.getExe cfg.package)];
          EnvironmentVariables = {
            RUST_BACKTRACE = "1";
            RUST_LOG = "error,warn,info";
          };
          RunAtLoad = true;
          KeepAlive = {
            Crashed = true;
            SuccessfulExit = false;
          };
          LimitLoadToSessionType = "Aqua";
          ProcessType = "Interactive";
          Nice = -20;
          StandardOutPath = "${homeConfig.xdg.stateHome}/rift/stdout.log";
          StandardErrorPath = "${homeConfig.xdg.stateHome}/rift/stderr.log";
        };
      };
    };
  }
