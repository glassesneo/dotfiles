{pkgs, ...}: {
  environment.systemPackages = with pkgs; [
    arc-browser
    discord
    kitty
    maccy
    raycast
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
