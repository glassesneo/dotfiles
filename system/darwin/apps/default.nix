{pkgs, ...}: {
  environment.systemPackages = with pkgs; [
    raycast
  ];
  imports = [
    ./services.nix
    ./homebrew.nix
  ];
}
