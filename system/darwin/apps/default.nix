{pkgs, ...}: {
  environment.systemPackages = with pkgs; [
    discord
    kitty
    maccy
    raycast
    slack
    tart
    zed-editor
  ];
  imports = [
    ./services.nix
    ./homebrew.nix
  ];
}
