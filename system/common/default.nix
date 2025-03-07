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
      ];
    };
    package = pkgs.nix;
  };
  imports = [
    ./fonts.nix
  ];
}
