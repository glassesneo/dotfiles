{
  inputs,
  denix,
  pkgs,
  system,
}: let
  lib = pkgs.lib;

  configuration = denix.lib.denixConfiguration {
    extraInputs = inputs;

    modules = [
      ../../adapters/hjem.nix
      ./fixture.nix
    ];
  };

  result = configuration.genSystem {
    moduleSystem = "hjem";

    extraArgs = {
      inherit system;
      username = "fixture";
      homeDirectory = "/tmp/hjem-adapter-fixture";
    };
  };

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
