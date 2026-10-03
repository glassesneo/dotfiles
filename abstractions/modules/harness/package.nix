# Not named default.nix: Denix would discover it as an abstraction.
{
  bun2nix,
  lib,
}:
bun2nix.mkDerivation {
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

  # A custom buildPhase re-enables fixup, which breaks Bun executables.
  dontFixup = true;

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    "$out/bin/harness" --version
    runHook postInstallCheck
  '';
}
