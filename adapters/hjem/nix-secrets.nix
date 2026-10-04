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
  activate = pkgs.writeShellScript "nix-secrets-activate" ''
    set -eu
    export HOME=${lib.escapeShellArg config.directory}
    export PATH=${lib.escapeShellArg "${lib.optionalString (cfg.extraPackages != []) "${lib.makeBinPath cfg.extraPackages}:"}/usr/bin:/bin:/usr/sbin:/sbin"}
    exec ${cfg.activate.command false}
  '';
in {
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
        # CLI lookup uses this Hjem user's generated manifest regardless of
        # --flake; override nixEvalCommand to target another configuration.
        nixEvalCommand = lib.mkDefault "${pkgs.coreutils}/bin/cat ${pkgs.writeText "nix-secrets-manifest.json" cfg.manifest}";
        generatorBuildCommand = lib.mkDefault "${pkgs.nix}/bin/nix-store --realise {{input}}";
      };
    })
    (lib.mkIf (cfg.enable && cfg.activate.enable) {
      userServices.nix-secrets-activate = {
        command = ["${activate}"];
        # Reconciliation kickstarts on initial registration too; avoid a second
        # RunAtLoad start that could be killed midway through disk creation.
        autoStart = false;
        restartOnSwitch = true;
      };
      platform.darwin.launchAgents.nix-secrets-activate = {
        domain = "user";
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
