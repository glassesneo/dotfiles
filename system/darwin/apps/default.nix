{pkgs, ...}: {
  environment.systemPackages = with pkgs; [
    maccy
    raycast
    tart
    thunderbird
  ];
  imports = [
    ./services.nix
    ./homebrew.nix
  ];
}
