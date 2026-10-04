# Shared isolated fixture: sandboxed wiring checks and explicit live activation.
{
  inputs,
  homeDirectory,
  username,
  extraModules ? [],
}: let
  pkgs = inputs.nixpkgs.legacyPackages.aarch64-darwin;
  makeSystem = (import ../../adapters/hjem {inherit inputs;}).moduleSystems.hjem.makeSystem;
  result = makeSystem {
    extraArgs = {
      system = "aarch64-darwin";
      inherit username homeDirectory;
    };
    modules =
      [
        ({
          config,
          lib,
          ...
        }: let
          cfg = config.security.nix-secrets;
        in {
          security.nix-secrets = {
            enable = lib.mkDefault true;
            installPackage = false;
            storage = "${homeDirectory}/storage";
            identityPaths = ["${homeDirectory}/key.txt"];
            baseDir = "${homeDirectory}/activated";
            generationsDir = "${homeDirectory}/generations";
            secrets.dummy = {};
          };
          platform.darwin.launchAgents = lib.mkIf (cfg.enable && cfg.activate.enable) {
            nix-secrets-activate.config.Label = lib.mkForce "org.hjem.nix-secrets-probe";
          };
          files = {
            "manifest.json".text = cfg.manifest;
            "cli-env.json".text = builtins.toJSON config.environment.sessionVariables;
            "secret-path".text = cfg.secrets.dummy.path;
            "activate".source = pkgs.writeShellScript "probe-activate" ''
              export PATH=/usr/bin:/bin:/usr/sbin:/sbin
              exec ${cfg.activate.command false}
            '';
            "keygen".source = pkgs.writeShellScript "probe-keygen" ''
              exec ${cfg.package}/bin/nix-secrets keygen "$@"
            '';
            "age".source = "${pkgs.age}/bin/age";
          };
        })
      ]
      ++ extraModules;
  };
in {
  inherit result;
  probe = pkgs.linkFarm "nix-secrets-probe" (
    map (file: {
      name = builtins.baseNameOf file.target;
      path = file.source;
    })
    result.manifest.files
    ++ [
      {
        name = "services";
        path = result.serviceApply;
      }
    ]
  );
}
