{pkgs, ...}: {
  environment.systemPackages = with pkgs; [
    discord
    kitty
    maccy
    raycast
    slack
    zed-editor
  ];
  imports = [
    ./services.nix
    ./homebrew.nix
  ];
}
