{
  inputs,
  denix,
  pkgs,
  system,
  configuration,
}: let
  lib = pkgs.lib;

  # Section translation, filtering, and assertion forwarding are repository-owned:
  # Nix types cannot detect a dropped section, leaked private bundle, or bypassed
  # guard. Observe published names/packages at genSystem, not adapter internals.
  genBundles = genSystem: extraModules:
    genSystem {
      moduleSystem = "bundles";
      extraArgs = {inherit system;};
      inherit extraModules;
    };
  evaluate = modules: extraModules:
    genBundles
    (denix.lib.denixConfiguration {
      extraInputs = inputs;
      modules =
        [
          ../../adapters/bundles.nix
        ]
        ++ modules;
    }).genSystem
    extraModules;

  feature = {delib, ...}:
    delib.module {
      name = "fixture";
      options.enable = delib.boolOption true;
      bundles.always = {
        unconditional = {
          package = pkgs.hello;
          publish = true;
        };
        private.package = pkgs.hello;
        incomplete = {};
      };
      bundles.ifEnabled.selected = {
        package = pkgs.hello;
        publish = true;
      };
      # Function sections must survive the adapter's prefix transformation too.
      bundles.ifDisabled = {pkgs, ...}: {
        fallback = {
          package = pkgs.zsh;
          publish = true;
        };
      };
    };

  enabled = evaluate [feature] [];
  disabled = evaluate [feature] [{myconfig.fixture.enable = false;}];
  # Use the real bridge: a synthetic forwarder could hide missing wiring.
  assertionResult = assertion:
    genBundles configuration.genSystem [
      {
        myconfig.assertions = [
          {
            inherit assertion;
            message = "Bundle assertion probe";
          }
        ];
      }
    ];
  missingPackage = evaluate [
    ({delib, ...}:
      delib.module {
        name = "missing-package";
        bundles.always.missing.publish = true;
      })
  ] [];

  # Force package values: attrNames alone would miss a lazy missing-option error.
  succeeds = result:
    (builtins.tryEval (builtins.deepSeq (lib.mapAttrs (_: package: package.drvPath) result) true)).success;
  published = genBundles configuration.genSystem [];
in
  assert lib.assertMsg (
    builtins.attrNames enabled
    == ["selected" "unconditional"]
    && enabled.selected.drvPath == pkgs.hello.drvPath
    && enabled.unconditional.drvPath == pkgs.hello.drvPath
    && builtins.attrNames disabled == ["fallback" "unconditional"]
    && disabled.fallback.drvPath == pkgs.zsh.drvPath
    && disabled.unconditional.drvPath == pkgs.hello.drvPath
  ) "Bundle sections must gate correctly and omit unpublished entries without forcing their packages";
  assert lib.assertMsg (
    succeeds (assertionResult true)
    && !(succeeds (assertionResult false))
  ) "Common assertions must block the whole published bundle result";
  assert lib.assertMsg (!succeeds missingPackage)
  "A published bundle without a package must fail when consumed";
  # This integration assertion covers discovery/publication/flake export, not the
  # harness implementation. Comparing drvPaths does not build the harness.
  assert lib.assertMsg (
    builtins.attrNames published
    == ["harness"]
    && published.harness.drvPath == inputs.self.packages.${system}.harness.drvPath
  ) "Hostless publication must expose harness through the flake package output";
    pkgs.runCommand "bundles-test" {} ''
      mkdir "$out"
    ''
