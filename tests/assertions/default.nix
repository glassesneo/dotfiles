{
  configuration,
  pkgs,
  ...
}: let
  lib = pkgs.lib;

  # The real composition must forward shared assertions into Hjem's guard.
  # Adapter-only checks cannot detect a missing assertions module or forwarding.
  # Inject at the ordinary Nix module boundary, without creating a Denix feature.
  probe = hostName: userName: user: assertion:
    configuration.genSystem {
      moduleSystem = "hjem";
      host = hostName;
      extraArgs = {
        system = configuration.config.hosts.${hostName}.system;
        username = userName;
        inherit (user) homeDirectory;
      };
      extraModules = [
        {
          myconfig.assertions = [
            {
              inherit assertion;
              message = "Assertion forwarding probe";
            }
          ];
        }
      ];
    };

  results = lib.concatLists (lib.mapAttrsToList (hostName: host:
    lib.mapAttrsToList (userName: user: let
      passing = probe hostName userName user true;
      failing = probe hostName userName user false;
    in
      (builtins.tryEval passing.manifest).success
      && !(builtins.tryEval failing.manifest).success)
    host.users)
  configuration.config.hosts);
in
  assert lib.assertMsg (results != [] && lib.all (result: result) results)
  "Real host configurations must accept passing assertions and reject failing assertions";
    pkgs.runCommand "assertion-forwarding-test" {} ''
      mkdir "$out"
    ''
