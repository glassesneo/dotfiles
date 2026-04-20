{
  delib,
  homeConfig,
  inputs,
  lib,
  pkgs,
  ...
}: let
  serviceLabel = "git.acsandmann.rift";
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
      moduleOptions ({myconfig, ...}: {
        # Rift activation is derived from the host-selected window-manager
        # backend so exactly one WM provider is active per host.
        enable = boolOption (
          pkgs.stdenv.isDarwin
          && myconfig.services.windowManagement.enable
          && myconfig.services.windowManagement.backend == "rift"
        );
        package = readOnly (packageOption rift);
      });

    darwin.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: {
      # Rift requires macOS "Displays have separate Spaces" enabled (i.e.
      # com.apple.spaces.spans-displays = 0). That preference is owned by
      # nix-darwin.preferences.spaces, which writes the key when enabled. This
      # assertion guards only the preference module's enable flag — it does not
      # verify the final key/value. If the preferences module changes which key
      # it writes, this check must be tightened.
      assertions = [
        {
          assertion = myconfig.nix-darwin.preferences.spaces.enable;
          message = "services.rift requires nix-darwin.preferences.spaces.enable = true so that 'Displays have separate Spaces' (com.apple.spaces.spans-displays = 0) stays applied.";
        }
      ];

      environment.systemPackages = [cfg.package];
    };

    home.ifEnabled = {cfg, ...}: {
      home.packages = [cfg.package];

      xdg.configFile."rift/config.toml".source = ./config.toml;

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
