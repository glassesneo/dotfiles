{pkgs, ...}: {
  brew-nix.enable = true;
  environment.systemPackages = with pkgs.brewCasks; [
    keycastr
    marta
    orbstack
    proton-drive
    proton-pass
    qlmarkdown
  ];
}
