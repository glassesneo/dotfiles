{
  delib,
  inputs,
  moduleSystem,
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

  # Apply brew-nix overlay for standalone home-manager only
  # In standalone mode (moduleSystem == "home"), we're running on macOS with `nh home switch`
  # In integrated mode (moduleSystem == "darwin"), the overlay is already applied in darwin.always
  # This prevents the overlay from being applied on future NixOS standalone configurations
  home.always = {
    nixpkgs.overlays =
      if moduleSystem == "home"
      then [inputs.brew-nix.overlays.default]
      else [];
  };

  myconfig.always.args.shared.brewCasks =
    if pkgs ? brewCasks
    then pkgs.brewCasks
    else {};
}
