{
  inputs,
  denix,
  pkgs,
  system,
}: let
  lib = pkgs.lib;

  # Repository-owned contract: an exclusive Hjem file fails when more than one
  # Denix module or host defines it. Provenance labels make them distinguishable.
  writer = name: enabled: file: {delib, ...}:
    delib.module {
      inherit name;
      options.enable = delib.boolOption enabled;
      hjem.ifEnabled.files.${file}.text = name;
    };

  owner = {delib, ...}:
    delib.module {
      name = "owner";
      hjem.always.files.".owned" = {
        exclusive = true;
        text = "owner";
      };
    };

  host = file: {delib, ...}:
    delib.host {
      name = "fixture";
      system = system;
      users.fixture = {};
      hjem.ifEnabled.files.${file}.text = "host";
    };

  manifest = modules:
    ((denix.lib.denixConfiguration {
        extraInputs = inputs;
        modules =
          [
            denix.denixModules.nixDarwin
            ../../adapters/hjem.nix
            ../../extensions/hosts.nix
            ../../extensions/provenance.nix
            owner
          ]
          ++ modules;
      }).genSystem {
        moduleSystem = "hjem";
        host = "fixture";
        extraArgs = {
          inherit system;
          username = "fixture";
          homeDirectory = "/tmp/exclusive-files-fixture";
        };
      }).manifest;

  # The assertion guard wraps the whole result, so forcing the manifest evaluates it.
  succeeds = modules: (builtins.tryEval (manifest modules)).success;
in
  assert lib.assertMsg (succeeds [(host ".other")])
  "A single owner must satisfy exclusivity";
  assert lib.assertMsg (succeeds [(host ".other") (writer "disabled" false ".owned")])
  "A disabled module must not count as a definer";
  assert lib.assertMsg (succeeds [(host ".shared") (writer "a" true ".shared") (writer "b" true ".shared")])
  "Non-exclusive files must still merge";
  assert lib.assertMsg (!succeeds [(host ".other") (writer "intruder" true ".owned")])
  "A second module defining an exclusive file must fail";
  assert lib.assertMsg (!succeeds [(host ".owned")])
  "A host defining an exclusive file must fail";
    pkgs.runCommand "exclusive-files-test" {} ''
      mkdir "$out"
    ''
