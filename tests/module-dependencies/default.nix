{
  inputs,
  denix,
  pkgs,
}: let
  lib = pkgs.lib;

  # Repository-owned contract: disabling a parent gates child defaults without
  # masking explicit child overrides, and conflicts produce failed assertions.
  # Assertion enforcement is tested at the consumer boundary, not here.
  feature = name: enabled: {delib, ...}:
    delib.module {
      inherit name;
      options.enable = delib.boolOption enabled;
    };

  evaluate = overrides: let
    configuration = denix.lib.denixConfiguration {
      extraInputs = inputs;
      modules = [
        ../../extensions/module-dependencies.nix
        (feature "parent" true)
        ({delib, ...}:
          delib.module ({myconfig, ...}: {
            name = "parent.child";
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
            options.value = delib.strOption "setting";
          })
        ({delib, ...}:
          delib.module {
            name = "test-overrides";
            myconfig.always = overrides;
          })
      ];
    };
  in {
    config =
      (lib.evalModules {
        modules = [
          (configuration.genModule {})
          {
            options.myconfig.assertions = lib.mkOption {
              type = lib.types.listOf lib.types.unspecified;
              default = [];
            };
          }
        ];
        specialArgs = {inherit pkgs;};
      }).config.myconfig;
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
    lib.all (entry: entry.assertion) normal.config.assertions
    && lib.all (entry: entry.assertion) disabled.config.assertions
    && lib.any (entry: !entry.assertion) conflict.config.assertions
  ) "An enabled child with a disabled parent must produce a failed assertion";
    pkgs.runCommand "module-dependencies-test" {} ''
      mkdir "$out"
    ''
