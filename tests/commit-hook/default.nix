# Git/pre-commit do not guarantee our auto-staging policy. Exercise real commits
# with a fake Nix executable: guards preserve user work, fixes enter the commit,
# and failed validation prevents the commit without discarding staged fixes.
{
  pkgs,
  inputs,
  system,
}: let
  fakeNix = pkgs.writeScriptBin "nix" ''
    #!${pkgs.python3}/bin/python3
    ${builtins.readFile ./fake-nix.py}
  '';
  hooks = import ../../git-hooks.nix {
    pkgs = pkgs // {nix = fakeNix;};
    git-hooks = inputs.git-hooks;
    inherit system;
    src = ../..;
  };
in
  pkgs.runCommand "commit-hook" {
    nativeBuildInputs = [pkgs.git pkgs.python3];
  } ''
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    python ${./test.py} ${hooks.directory}
    touch "$out"
  ''
