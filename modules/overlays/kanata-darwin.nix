{
  delib,
  inputs,
  ...
}:
delib.overlayModule {
  name = "kanata-darwin-overlay";

  overlay = inputs.kanata-darwin-nix.overlays.default;

  targets = ["darwin"];
  enabled = true;
}
