{
  delib,
  lib,
  pkgs,
  ...
}: let
  shared.nix = {
    package = lib.mkDefault pkgs.nix;
    settings = {
      experimental-features = ["nix-command" "flakes" "pipe-operators"];
      warn-dirty = false;
      substituters = [
        "https://cache.nixos.org"
      ];
    };
  };
in
  delib.module {
    name = "nix";

    # nixos.always = shared;
    home.always = shared;
    darwin.always = shared;
  }
