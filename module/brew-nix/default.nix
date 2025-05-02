{pkgs, ...}: {
  brew-nix.enable = true;
  environment.systemPackages = with pkgs.brewCasks; [
    canva
    # ghostty
    keycastr
    marta
    orbstack
    proton-drive
    proton-pass
  ];
}
