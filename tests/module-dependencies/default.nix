{
  inputs,
  denix,
  pkgs,
  system,
}: let
  lib = pkgs.lib;

  # Repository-owned contract: disabling a parent gates child defaults without
  # masking explicit child overrides. Hjem's existing check owns assertion forwarding.
  feature = name: enabled: {delib, ...}:
    delib.module {
      inherit name;
      meta.description = "Provide a feature for the module dependency fixture.";
      options.enable = delib.boolOption enabled;
    };

  evaluate = overrides: let
    configuration = denix.lib.denixConfiguration {
      extraInputs = inputs;
      modules = [
        denix.denixModules.nixDarwin
        ../../adapters/hjem.nix
        ../../abstractions/modules/assertions/default.nix
        ../../extensions/module-dependencies.nix
        ../../extensions/module-metadata.nix
        (feature "parent" true)
        ({delib, ...}:
          delib.module ({myconfig, ...}: {
            name = "parent.child";
            meta.description = "Exercise a child whose default depends on parent settings.";
            options = {pkgs, ...}: {
              enable = delib.boolOption (myconfig.parent.settings.value == "setting");
              package = delib.packageOption pkgs.zsh;
            };
          }))
        (feature "parent.conditional" false)
        (feature "parent.missing.child" true)
        (feature "absent.child" true)
        (feature "parent.settings.child" true)
        ({delib, ...}:
          delib.module {
            name = "parent.settings";
            meta.description = "Provide parent settings for conditional child defaults.";
            options.value = delib.strOption "setting";
          })
        ({delib, ...}:
          delib.module {
            name = "test-overrides";
            meta.description = "Apply overrides for the module dependency fixture.";
            myconfig.always = overrides;
          })
      ];
    };
  in {
    config =
      (lib.evalModules {
        modules = [(configuration.genModule {})];
        specialArgs = {inherit pkgs;};
      }).config.myconfig;
    result = configuration.genSystem {
      moduleSystem = "hjem";
      extraArgs = {
        inherit system;
        username = "fixture";
        homeDirectory = "/tmp/module-dependencies-fixture";
      };
    };
  };

  normal = evaluate {};
  disabled = evaluate {parent.enable = false;};
  conflict = evaluate {
    parent.enable = false;
    parent.child.enable = true;
  };
  explicit = evaluate {parent.conditional.enable = true;};
  conditionOff = evaluate {parent.settings.value = "other";};
in
  assert lib.assertMsg (
    normal.config.parent.child.enable
    && normal.config.parent.child.package == pkgs.zsh
    && !conditionOff.config.parent.child.enable
    && !normal.config.parent.conditional.enable
    && !disabled.config.parent.child.enable
    && !disabled.config.parent.conditional.enable
    && disabled.config.parent.missing.child.enable
    && disabled.config.absent.child.enable
    && disabled.config.parent.settings.value == "setting"
    && disabled.config.parent.settings.child.enable
    && explicit.config.parent.conditional.enable
    && conflict.config.parent.child.enable
  ) "Module dependency defaults or overrides failed";
  assert lib.assertMsg (
    (builtins.tryEval disabled.result.manifest).success
    && !(builtins.tryEval conflict.result.manifest).success
  ) "An enabled child with a disabled parent must fail evaluation";
    pkgs.runCommand "module-dependencies-test" {} ''
      mkdir "$out"
    ''
