{pkgs, ...}: {
  # users.users."${userName}" = {
  #   name = userName;
  #   home = builtins.getEnv "HOME";
  # };

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
