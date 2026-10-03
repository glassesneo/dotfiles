# Check that every committed bun.nix is what `just bun` writes from the bun.lock
# beside it, so a lock changed with Bun directly fails before a build uses a
# stale dependency set.
{
  inputs,
  pkgs,
  system,
}: let
  inherit (pkgs) lib;
  locks = lib.fileset.toList (lib.fileset.fileFilter (file: file.name == "bun.lock") ../..);
in
  pkgs.runCommand "bun-lock-current" {
    nativeBuildInputs = [inputs.bun2nix.packages.${system}.default];
  } ''
    ${lib.concatMapStrings (lock: ''
        bun2nix --lock-file ${lock} --output-file expected.nix
        diff -u ${dirOf lock + "/bun.nix"} expected.nix
      '')
      locks}
    touch "$out"
  ''
