{
  pkgs,
  stdenv ? pkgs.stdenv,
  bun2nix ? pkgs.bun2nix,
  nodejs ? pkgs.nodejs,
  ...
}:
stdenv.mkDerivation {
  pname = "node-packages";
  version = "1.0.0";

  src = ./.;

  nativeBuildInputs = [
    bun2nix.hook
  ];

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.nix;
  };

  bunInstallFlags =
    if stdenv.hostPlatform.isDarwin
    then [
      "--linker=hoisted"
      "--backend=copyfile"
    ]
    else [
      "--linker=hoisted"
    ];

  dontUseBunBuild = true;
  dontUseBunCheck = true;
  dontUseBunInstall = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin $out/lib/node_modules

    # Copy the entire node_modules tree
    cp -r node_modules/. $out/lib/node_modules/

    # Symlink binaries from node_modules/.bin into $out/bin
    if [ -d node_modules/.bin ]; then
      for bin in node_modules/.bin/*; do
        [ -L "$bin" ] || continue
        local name=$(basename "$bin")
        local target=$(readlink -f "$bin")
        local relTarget="''${target#$PWD/}"
        ln -s "$out/lib/$relTarget" "$out/bin/$name"
      done
    fi

    # Ensure Node.js shebang for bin scripts
    for bin in $out/bin/*; do
      [ -L "$bin" ] || continue
      local target=$(readlink -f "$bin")
      if [ -f "$target" ] && head -1 "$target" | grep -q '^#!.*node\|^#!.*bun'; then
        substituteInPlace "$target" \
          --replace-quiet "#!/usr/bin/env node" "#!${nodejs}/bin/node" \
          --replace-quiet "#!/usr/bin/env bun" "#!${nodejs}/bin/node"
      fi
    done

    runHook postInstall
  '';
}
