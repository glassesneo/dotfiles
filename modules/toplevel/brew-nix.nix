{
  delib,
  inputs,
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
    imports = [
      inputs.brew-nix.darwinModules.default
    ];

    brew-nix.enable = true;

    environment.systemPackages = with pkgs; [
      brewCasks.keycastr
      brewCasks.orbstack
      brewCasks.proton-drive
      brewCasks.proton-pass
      brewCasks.qlmarkdown
      brewCasks.claude
    ];
  };

  myconfig.always.args.shared.brewCasks = pkgs.brewCasks;
}
