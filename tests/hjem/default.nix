{
  inputs,
  denix,
  pkgs,
  system,
}: let
  lib = pkgs.lib;

  # Hjem provides the `assertions` option itself (it imports nixpkgs' module), and
  # the assertions feature forwards `myconfig.assertions` into it. Both are needed
  # so the forwarding path is exercised, and nix-darwin registers the `darwin`
  # side that the feature also configures.
  baseModules = [
    denix.denixModules.nixDarwin
    ../../adapters/hjem.nix
    ../../extensions/module-metadata.nix
    ../../abstractions/modules/assertions/default.nix
  ];

  mkResult = extraModules:
    (denix.lib.denixConfiguration {
      extraInputs = inputs;
      modules = baseModules ++ extraModules;
    }).genSystem {
      moduleSystem = "hjem";

      extraArgs = {
        inherit system;
        username = "fixture";
        homeDirectory = "/tmp/hjem-adapter-fixture";
      };
    };

  assertionModule = assertions: {delib, ...}:
    delib.module ({...}: {
      name = "test-assertions";
      meta.description = "Contribute assertions for the Hjem forwarding fixture.";
      myconfig.always.assertions = assertions;
    });

  result = mkResult [
    ./fixture.nix
    (assertionModule [
      {
        assertion = true;
        message = "passing assertion";
      }
    ])
  ];

  # A passing assertion must not be reported, and later failures must not be
  # skipped: an implementation that only inspects the first assertion would let
  # this configuration through.
  failing = mkResult [
    (assertionModule [
      {
        assertion = true;
        message = "passing assertion";
      }
      {
        assertion = false;
        message = "first failure";
      }
      {
        assertion = false;
        message = "second failure";
      }
    ])
  ];

  # The guard wraps the whole result, so forcing any output must evaluate it.
  # `tryEval` reports only whether evaluation was blocked, not the message text.
  blockedOutputs =
    !(builtins.tryEval failing.manifest).success
    && !(builtins.tryEval failing.packages).success
    && !(builtins.tryEval failing.preflight).success;

  manifest = result.manifest;

  pick = suffix:
    lib.findFirst
    (file: lib.hasSuffix suffix file.target)
    (throw "Missing fixture file")
    manifest.files;

  textFile = pick "/from-text.txt";
  stringFile = pick "/from-string.json";
  drvFile = pick "/from-derivation.json";
  package = builtins.head result.packages;

  manifestFile =
    pkgs.writeText "hjem-test-manifest.json"
    (builtins.toJSON manifest);
in
  assert lib.assertMsg (
    manifest.version
    == 3
    && builtins.length manifest.files == 3
    && lib.all (file: file.type == "symlink" && !file.clobber) manifest.files
    && lib.all (file: !lib.hasSuffix "/disabled.txt" file.target) manifest.files
    && builtins.length result.packages == 1
  ) "Hjem adapter contract failed";
  assert lib.assertMsg blockedOutputs "Failed assertions must block manifest, packages, and preflight";
    pkgs.runCommand "hjem-adapter-test" {
      inherit manifestFile package;
      inherit (result) preflight;

      textPath = textFile.source;
      stringPath = stringFile.source;
      drvPath = drvFile.source;

      nativeBuildInputs = [inputs.hjem.packages.${system}.hjem];
    } ''
      set -eu

      hjem manifest validate --manifest "$manifestFile"

      for dependency in "$textPath" "$stringPath" "$drvPath" "$package"; do
        grep -Fxq "$dependency" "$preflight"
        test -e "$dependency"
      done

      grep -Fxq "Generated from text" "$textPath"
      grep -Eq '"mode"[[:space:]]*:[[:space:]]*"string"' "$stringPath"
      grep -Eq '"mode"[[:space:]]*:[[:space:]]*"derivation"' "$drvPath"
      test "$("$package/bin/fixture-tool")" = "fixture"

      mkdir "$out"
      touch "$out/passed"
    ''
