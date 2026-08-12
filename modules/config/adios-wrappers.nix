{
  delib,
  inputs,
  pkgs,
  ...
}: let
  adios = inputs.adios.adios;

  tree =
    adios {
      modules = adios.lib.inject [
        inputs.adios-wrappers.wrapperModules
      ];
    } {
      options."/nixpkgs" = {
        inherit pkgs;
      };
    };
in
  delib.module {
    name = "config.wrappers";

    myconfig.always.args.shared.wrappers = tree.modules;
  }
