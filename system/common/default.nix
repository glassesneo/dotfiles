{pkgs, ...}: {
  # users.users."${userName}" = {
  #   name = userName;
  #   home = builtins.getEnv "HOME";
  # };

  nixpkgs.config.allowUnfree = true;

  nix = {
    optimise.automatic = true;
    settings = {
      experimental-features = [
        "nix-command"
        "flakes"
        "pipe-operators"
      ];
    };
    package = pkgs.nix;
  };

  imports = [
    ./fonts.nix
  ];
}
