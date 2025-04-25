{pkgs, ...}: {
  environment.systemPackages = with pkgs; [
    discord
    kitty
    maccy
    raycast
    slack
    tart
    thunderbird
    # warp-terminal
    # zed-editor
  ];
  imports = [
    ./services.nix
    ./homebrew.nix
  ];
}
