{delib, ...}: let
  shared.nixpkgs.config = {
    allowUnfree = true;
  };
in
  delib.module {
    name = "nixpkgs";

    darwin.always = shared;
    home.always = shared;
  }
