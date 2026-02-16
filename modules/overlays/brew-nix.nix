{
  delib,
  inputs,
  ...
}:
delib.overlayModule {
  name = "brew-nix-overlay";

  overlay = inputs.brew-nix.overlays.default;

  targets = ["home"];
  enabled = true;
}
