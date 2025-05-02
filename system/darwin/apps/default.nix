{pkgs, ...}: {
  environment.systemPackages = with pkgs; [
    maccy
    raycast
    tart
  ];
  imports = [
    ./services.nix
    ./homebrew.nix
  ];
}
