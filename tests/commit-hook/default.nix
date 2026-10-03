# Git/pre-commit do not guarantee our auto-staging policy. Exercise real commits
# with a fake Nix executable: guards preserve user work, fixes enter the commit,
# and failed validation prevents the commit without discarding staged fixes.
{
  pkgs,
  inputs,
  system,
}: let
  fakeNix = pkgs.writeShellScriptBin "nix" ''
    exec ${pkgs.nushell}/bin/nu --no-config-file ${./fake-nix.nu} "$@"
  '';
  hooks = import ../../git-hooks.nix {
    pkgs = pkgs // {nix = fakeNix;};
    git-hooks = inputs.git-hooks;
    inherit system;
    src = ../..;
  };
in
  pkgs.runCommand "commit-hook" {
    nativeBuildInputs = [pkgs.git pkgs.nushell];
  } ''
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    nu --no-config-file ${./test.nu} ${hooks.directory}
    touch "$out"
  ''
