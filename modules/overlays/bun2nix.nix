{
  delib,
  inputs,
  ...
}:
delib.overlayModule {
  name = "bun2nix";

  overlay = inputs.bun2nix.overlays.default;

  targets = ["home" "darwin"];
  enabled = true;
}
