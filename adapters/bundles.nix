# Owns the bundles module system, bundle schema, publication filter, and result
# contract: a name-to-package attrset guarded by common assertions.
{
  inputs,
  delib,
  lib,
  config,
  ...
}: {
  moduleSystems.bundles = {
    flakeOutputs = {
      modules = null;
      systems = null;
    };

    applyConfigForModuleSystem = value:
      lib.optional (config.moduleSystem.name or null == "bundles")
      (delib.processModule (delib.modules.addPrefixToModule ["bundles"]) value);

    makeSystem = {
      modules,
      extraArgs,
      ...
    }: let
      pkgs = inputs.nixpkgs.legacyPackages.${extraArgs.system};
      evaluation = lib.evalModules {
        specialArgs = {inherit pkgs;};
        modules =
          [
            {
              options = {
                bundles = lib.mkOption {
                  type = lib.types.attrsOf (lib.types.submodule {
                    options = {
                      package = lib.mkOption {
                        type = lib.types.package;
                        description = "The package containing this bundle's configuration.";
                      };
                      publish = lib.mkOption {
                        type = lib.types.bool;
                        default = false;
                        description = "Whether to include this bundle in the published packages.";
                      };
                    };
                  });
                  default = {};
                  description = "Feature-owned bundles and their publication choices.";
                };
                assertions = lib.mkOption {
                  type = lib.types.listOf lib.types.unspecified;
                  default = [];
                  description = "Assertions that must hold before returning published bundles.";
                };
              };
            }
          ]
          ++ modules;
      };
      cfg = evaluation.config;
      failedAssertions = map (x: x.message) (lib.filter (x: !x.assertion) cfg.assertions);
    in
      if failedAssertions != []
      then throw "\nFailed assertions:\n${lib.concatStringsSep "\n" (map (x: "- ${x}") failedAssertions)}"
      else lib.mapAttrs (_: bundle: bundle.package) (lib.filterAttrs (_: bundle: bundle.publish) cfg.bundles);
  };
}
