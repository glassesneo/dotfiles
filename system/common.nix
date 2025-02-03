{ pkgs, ... }:
let
  userName = builtins.getEnv "USER";
in
{
  users.users."${userName}" = {
    name = userName;
    home = builtins.getEnv "HOME";
  };

  nix = {
    optimise.automatic = true;
    settings = {
      experimental-features = [
        "nix-command"
        "flakes"
      ];
    };
    package = pkgs.nix;
  };
}
