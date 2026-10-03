{
  inputs,
  denix,
  pkgs,
  system,
}: let
  lib = pkgs.lib;

  # Repository-owned boundary: generated modules must reject missing metadata,
  # including on disabled features. Nix types validate strings once forced;
  # this check covers the extension's forcing and its exclusion of hosts.
  evaluate = metadata: let
    configuration = denix.lib.denixConfiguration {
      extraInputs = inputs;
      modules = [
        ../../extensions/module-metadata.nix
        ({delib, ...}: {
          imports = [
            (delib.module ({
                name = "fixture";
                options.enable = delib.boolOption false;
              }
              // metadata))
            (delib.host {name = "fixture-host";})
          ];
        })
      ];
    };
    generated = lib.evalModules {
      modules = [(configuration.genModule {})];
    };
  in {
    description = configuration.config.modules.fixture.meta.description;
    enabled = generated.config.myconfig.fixture.enable;
  };

  valid = evaluate {meta.description = "Owns the fixture responsibility.";};
  accepts = metadata: (builtins.tryEval (evaluate metadata).enabled).success;
in
  assert lib.assertMsg (
    valid.description
    == "Owns the fixture responsibility."
    && valid.enabled == false
  ) "Module descriptions must be accessible, and hosts need no description";
  assert lib.assertMsg (
    !(accepts {})
    && !(accepts {meta.description = "";})
    && !(accepts {meta.description = " \t\n\r";})
    && !(accepts {meta.description = 42;})
  ) "Generated modules must reject missing or invalid descriptions, even when disabled";
    pkgs.runCommand "module-metadata-test" {} ''
      mkdir "$out"
    ''
