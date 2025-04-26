{pkgs, ...}: {
  brew-nix.enable = true;
  environment.systemPackages = with pkgs.brewCasks; [
    canva
    ghostty
    keycastr
    marta
    notion
    orbstack
    proton-drive
    proton-pass
  ];
}
