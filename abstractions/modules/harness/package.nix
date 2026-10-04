# Not named default.nix: Denix would discover it as an abstraction.
#
# `settings` become the harness's user-level pi settings: the executable is
# wrapped to pass them with `--config`, and it reads no other user settings file.
{
  bun2nix,
  lib,
  makeWrapper,
  nodejs,
  runCommand,
  writeText,
  settings ? {},
}: let
  unwrapped = bun2nix.mkDerivation {
    packageJson = ./package.json;

    src = lib.fileset.toSource {
      root = ./.;
      fileset = lib.fileset.unions [
        ./package.json
        ./bun.lock
        ./bunfig.toml
        ./tsconfig.json
        ./build.ts
        ./src
      ];
    };

    bunDeps = bun2nix.fetchBunDeps {
      bunNix = ./bun.nix;
    };

    buildPhase = ''
      runHook preBuild
      bun run build.ts
      runHook postBuild
    '';

    # Bun's bundler strips types without checking them.
    doCheck = true;
    checkPhase = ''
      runHook preCheck
      bun node_modules/typescript/bin/tsc --noEmit
      runHook postCheck
    '';

    # A compiled pi looks for its package.json, themes, docs, and other assets
    # beside the executable, as in pi's own release layout (its
    # `copy-binary-assets` script); the executable is kept out of bin/ so that
    # they do not land on PATH.
    installPhase = ''
      runHook preInstall
      dir="$out/libexec/harness"
      pi=node_modules/@earendil-works/pi-coding-agent
      install -Dm755 harness "$dir/harness"
      cp -L "$pi"/{package.json,README.md,CHANGELOG.md} "$dir/"
      cp -rL "$pi/docs" "$pi/examples" "$dir/"
      mkdir -p "$dir/theme" "$dir/assets" "$dir/export-html"
      cp -L "$pi"/dist/modes/interactive/theme/*.json "$dir/theme/"
      cp -L "$pi"/dist/modes/interactive/assets/*.png "$dir/assets/"
      cp -L "$pi"/dist/core/export-html/template.* "$dir/export-html/"
      cp -rL "$pi/dist/core/export-html/vendor" "$dir/export-html/"
      runHook postInstall
    '';

    # A custom buildPhase re-enables fixup, which breaks Bun executables.
    dontFixup = true;

    doInstallCheck = true;
    installCheckPhase = ''
      runHook preInstallCheck
      "$out/libexec/harness/harness" --version
      runHook postInstallCheck
    '';
  };

  # pi installs the npm packages listed in `packages` with npm, which a user
  # running the harness through Nix may not have.
  settingsFile = writeText "harness-settings.json" (builtins.toJSON ({
      npmCommand = [(lib.getExe' nodejs "npm")];
    }
    // settings));
in
  runCommand "harness-${unwrapped.version}" {
    nativeBuildInputs = [makeWrapper];
    meta.mainProgram = "harness";
  } ''
    makeWrapper ${unwrapped}/libexec/harness/harness "$out/bin/harness" \
      --add-flags "--config ${settingsFile}"
  ''
