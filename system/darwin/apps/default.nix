{pkgs, ...}: {
  environment.systemPackages = with pkgs; [
    maccy
    raycast
    tart
    amazon-q-cli
  ];
  imports = [
    ./services.nix
    ./homebrew.nix
  ];
}
