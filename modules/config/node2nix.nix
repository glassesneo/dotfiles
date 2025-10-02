{
  delib,
  pkgs,
  ...
}: let
  nodePkgs = pkgs.callPackage ../../node2nix {inherit pkgs;};
in
  delib.module {
    name = "node2nix";

    myconfig.always.args.shared.nodePkgs = nodePkgs;
  }
