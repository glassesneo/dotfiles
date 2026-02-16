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
    imports = [
      inputs.brew-nix.darwinModules.default
    ];

    brew-nix.enable = true;
  };

  myconfig.always.args.shared.brewCasks =
    if pkgs ? brewCasks
    then pkgs.brewCasks
    else {};
}
