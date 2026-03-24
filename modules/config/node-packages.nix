{
  delib,
  pkgs,
  ...
}: let
  nodePackages = pkgs.callPackage ../../node-packages {inherit pkgs;};
in
  delib.module {
    name = "node-packages";

    myconfig.always.args.shared = {
      inherit nodePackages;
    };
  }
