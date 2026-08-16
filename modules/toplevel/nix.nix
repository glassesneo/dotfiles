{
  delib,
  lib,
  pkgs,
  ...
}: let
  shared.nix = {
    package = lib.mkDefault pkgs.nix;
    settings = {
      experimental-features = ["nix-command" "flakes"];
      warn-dirty = false;
      trusted-users = ["root" "@admin" "neo"];
      substituters = [
        "https://cache.nixos.org"
        "https://nix-community.cachix.org"
        "https://cache.numtide.com"
        "https://vicinae.cachix.org"
        "https://ryoppippi.cachix.org"
        "https://moocs-collect-nix.cachix.org"
      ];
      trusted-public-keys = [
        "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
        "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
        "niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g="
        "vicinae.cachix.org-1:1kDrfienkGHPYbkpNj1mWTr7Fm1+zcenzgTizIcI3oc="
        "ryoppippi.cachix.org-1:b2LbtWNvJeL/qb1B6TYOMK+apaCps4SCbzlPRfSQIms="
        "moocs-collect-nix.cachix.org-1:MpREl4nnQpusRFLilrWt2S67SW1mLuqM6HvcirF/CjE="
      ];
    };
  };
in
  delib.module {
    name = "nix";

    home.always = shared;

    darwin.always =
      shared
      // {
        nix =
          shared.nix
          // {
            gc = {
              automatic = true;
              interval = {
                Weekday = 0;
                Hour = 0;
                Minute = 0;
              };
              options = "--delete-older-than 3d";
            };

            optimise = {
              automatic = true;
              interval = {
                Weekday = 0;
                Hour = 1;
                Minute = 0;
              };
            };
          };
      };

    nixos.always =
      shared
      // {
        nix =
          shared.nix
          // {
            gc = {
              automatic = true;
              options = "--delete-older-than 3d";
            };

            optimise.automatic = true;
          };
      };
  }
