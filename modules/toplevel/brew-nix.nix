{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "brew-nix";

  options = delib.singleEnableOption true;

  darwin.always = {
    # nixpkgs.overlays = [
    # inputs.brew-nix.overlays.default
    # ];

    brew-nix.enable = true;

    environment.systemPackages = with pkgs; [
      brewCasks.keycastr
      brewCasks.orbstack
      brewCasks.proton-drive
      brewCasks.proton-pass
      brewCasks.qlmarkdown
    ];
  };

  myconfig.always.args.shared.brewCasks = pkgs.brewCasks;
}
