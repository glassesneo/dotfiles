{
  delib,
  inputs,
  pkgs,
  ...
}:
delib.module {
  name = "brew-nix";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {cfg, ...}: {
    # nixpkgs.overlays = [
    # inputs.brew-nix.overlays.default
    # ];

    brew-nix.enable = cfg.enable;

    environment.systemPackages = with pkgs.brewCasks; [
      keycastr
      marta
      orbstack
      proton-drive
      proton-pass
      qlmarkdown
    ];
  };
}
