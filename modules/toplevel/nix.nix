{
  delib,
  pkgs,
  ...
}: let
  shared.nix = {
    # package = pkgs.nix;
    settings = {
      experimental-features = ["nix-command" "flakes" "pipe-operators"];
      warn-dirty = false;
    };
  };
in
  delib.module {
    name = "nix";

    # nixos.always = shared;
    home.always = shared;
    darwin.always = shared;
  }
