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
      trusted-users = ["root" "@admin" "neo"];
      substituters = [
        "https://cache.nixos.org"
        "https://cache.numtide.com"
      ];
      trusted-public-keys = [
        "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
        "niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g="
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
