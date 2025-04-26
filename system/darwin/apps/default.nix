{pkgs, ...}: {
  environment.systemPackages = with pkgs; [
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
