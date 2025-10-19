{
  delib,
  inputs,
  pkgs,
  ...
}:
delib.module {
  name = "nur";

  options = delib.singleEnableOption true;

  home.always = {
    # nixpkgs.overlays = [
    # inputs.nur.overlays.default
    # ];
  };
}
