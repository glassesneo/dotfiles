# Standalone Hjem compatibility and Darwin activation for upstream nix-secrets.
# Secrets remain upstream options; registration does not imply consumer readiness.
# The default Darwin package verifies RAM backing before placing plaintext files.
{inputs}: {
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.security.nix-secrets;
  lockDir = "${config.xdg.state.directory}/nix-secrets";
  # Several triggers can start activation together, and upstream activation has no lock.
  activate = pkgs.writeShellScript "nix-secrets-activate" ''
    set -eu
    export HOME=${lib.escapeShellArg config.directory}
    export PATH=${lib.escapeShellArg "${lib.optionalString (cfg.extraPackages != []) "${lib.makeBinPath cfg.extraPackages}:"}/usr/bin:/bin:/usr/sbin:/sbin"}
    mkdir -p ${lib.escapeShellArg lockDir}
    exec /usr/bin/lockf -k ${lib.escapeShellArg "${lockDir}/activate.lock"} ${cfg.activate.command false}
  '';
in {
  options.security.nix-secrets.activateScript = lib.mkOption {
    type = lib.types.path;
    readOnly = true;
    description = "Darwin activation command, serialized with every other trigger that runs it.";
  };

  imports = [inputs.nix-secrets.hjemModules.default];
  # Upstream defines systemd options even when automatic activation is disabled.
  disabledModules = ["${inputs.nix-secrets}/nix/hjem/activate/systemd.nix"];

  config = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin (lib.mkMerge [
    {
      security.nix-secrets = {
        defaultGroup = lib.mkDefault "staff";
        package = lib.mkDefault ((pkgs.callPackage "${inputs.nix-secrets}/package.nix" {}).overrideAttrs (old: {
          patches =
            (old.patches or [])
            ++ [
              ./nix-secrets-darwin-anchor.patch
              ./nix-secrets-darwin-ram.patch
            ];
        }));
      };
    }
    (lib.mkIf cfg.enable {
      security.nix-secrets = {
        activateScript = activate;
        # CLI lookup uses this Hjem user's generated manifest regardless of
        # --flake; override nixEvalCommand to target another configuration.
        nixEvalCommand = lib.mkDefault "${pkgs.coreutils}/bin/cat ${pkgs.writeText "nix-secrets-manifest.json" cfg.manifest}";
        generatorBuildCommand = lib.mkDefault "${pkgs.nix}/bin/nix-store --realise {{input}}";
      };
    })
    (lib.mkIf (cfg.enable && cfg.activate.enable) {
      userServices.nix-secrets-activate = {
        command = ["${activate}"];
        # The RAM disk is gone after a reboot, so secrets are activated at login too.
        autoStart = true;
        restartOnSwitch = true;
      };
      platform.darwin.launchAgents.nix-secrets-activate = {
        # Login loads only Aqua agents; a Background agent runs only when bootstrapped.
        domain = "gui";
        config = {
          Label = "org.hjem.nix-secrets-activate";
          # Hjem's service reconciler creates Library/LaunchAgents before bootstrap.
          StandardErrorPath = "${config.directory}/Library/LaunchAgents/nix-secrets.stderr";
          StandardOutPath = "${config.directory}/Library/LaunchAgents/nix-secrets.stdout";
        };
      };
    })
  ]);
}
