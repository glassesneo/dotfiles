{
  inputs,
  denix,
  pkgs,
  system,
}: let
  root = ./.;
  entries = builtins.readDir root;

  tests =
    pkgs.lib.filterAttrs
    (name: type:
      type
      == "directory"
      && builtins.pathExists
      (root + "/${name}/default.nix"))
    entries;
in
  builtins.mapAttrs
  (name: _:
    import (root + "/${name}/default.nix") {
      inherit inputs denix pkgs system;
    })
  tests
