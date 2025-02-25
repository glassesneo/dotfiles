{pkgs, ...}: {
  environment.systemPackages = with pkgs; [
    sketchybar-app-font
  ];
  imports = [
    ./services.nix
    ./homebrew.nix
  ];
}
