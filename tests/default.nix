{
  inputs,
  denix,
  pkgs,
  system,
  configuration,
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
    pkgs.lib.callPackageWith {
      inherit inputs denix pkgs system configuration;
    } (root + "/${name}/default.nix") {})
  tests
